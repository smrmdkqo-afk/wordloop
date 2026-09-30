import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import {
  makeAssemblyQuestion,
  assemblyText,
  checkAssembly,
  formatQueue,
  recordAssembly,
  validAssemblyAlternatives,
} from "../src/assembly.js";
import { emptyState, recordAnswer, validateBackup } from "../src/core.js";
import { quizSpeech } from "../src/speech.js";

process.env.TZ = "Asia/Seoul";
const sense = {
  id: "custom-assembly",
  word: "walk",
  ko: "걷다",
  pos: "verb",
  level: "beginner",
  definitions: ["to walk slowly outside", "to move outside on foot"],
  examples: ["I {} to school.", "We {} together."],
  distractors: [],
};
const canonical = (q) =>
  q.tokens
    .filter((t) => t.id.startsWith("w"))
    .sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)))
    .map((t) => t.id);
const backup = (state) => ({ app: "wordloop", version: 1, state });
function attempt(state, day, correct, options = {}, target = sense) {
  const date = `2026-09-${String(day).padStart(2, "0")}`;
  const level =
    options.level ?? state.progress[target.id]?.assembly?.level ?? 0;
  const p = recordAnswer(state, target, correct, {
    now: new Date(`${date}T10:00:00+09:00`).getTime(),
    kind: "new",
  });
  recordAssembly(p, correct, { date, level, ...options });
  return p.assembly;
}

test("all catalog definitions assemble correctly at every distractor level", async () => {
  for (const file of await readdir("data")) {
    if (!file.endsWith(".json") || file === "manifest.json") continue;
    for (const s of JSON.parse(await readFile(`data/${file}`, "utf8")).senses) {
      const before = structuredClone(s);
      for (let d = 0; d < s.definitions.length; d++) {
        for (const level of [0, 1, 2]) {
          const q = makeAssemblyQuestion(
            s,
            { definitionIndex: d - 1 },
            level,
            () => 0.42,
          );
          assert.equal(q.level, level, s.id);
          assert.equal(q.tokens.length, q.requiredCount + level, s.id);
          assert.equal(
            new Set(q.tokens.map((t) => t.id)).size,
            q.tokens.length,
          );
          assert.equal(
            assemblyText(q, canonical(q)),
            s.definitions[d].normalize("NFKC").trim().replace(/\s+/g, " "),
            s.id,
          );
          assert(checkAssembly(q, canonical(q)), s.id);
          assert(!checkAssembly(q, canonical(q).slice(1)), s.id);
          for (const extra of q.tokens.filter((t) => t.id.startsWith("x")))
            assert(
              !s.definitions[d].toLowerCase().split(/\W+/).includes(extra.text),
              s.id,
            );
        }
      }
      assert.deepEqual(s, before);
    }
  }
});

test("shuffle never leaves the whole canonical sentence in order and cycles definitions", () => {
  const q = makeAssemblyQuestion(sense, {}, 0, () => 0.999);
  assert.notEqual(
    assemblyText(
      q,
      q.tokens.map((t) => t.id),
    ),
    sense.definitions[0],
  );
  const next = makeAssemblyQuestion(sense, q);
  assert.equal(next.definitionIndex, 1);
  assert.equal(next.exampleIndex, 1);
  assert.equal(makeAssemblyQuestion(sense, next).definitionIndex, 0);
});

test("identical word pieces may swap identities, but one piece cannot be reused", () => {
  const q = makeAssemblyQuestion({
    ...sense,
    definitions: ["to use a pen and a book"],
  });
  const ids = canonical(q);
  [ids[2], ids[5]] = [ids[5], ids[2]];
  assert(checkAssembly(q, ids));
  ids[5] = ids[2];
  assert(!checkAssembly(q, ids));
  ids[5] = "missing";
  assert(!checkAssembly(q, ids));
});

test("punctuation and contractions stay attached; casing and space are normalized", () => {
  const q = makeAssemblyQuestion({
    ...sense,
    definitions: ["To use someone’s book, then return it."],
  });
  assert(q.tokens.some((t) => t.text === "someone’s"));
  assert(q.tokens.some((t) => t.text === "book,"));
  assert(q.tokens.some((t) => t.text === "it."));
  q.tokens.find((t) => t.id === "w0").text = "to";
  q.tokens.find((t) => t.text === "someone’s").text = "someone's";
  assert(checkAssembly(q, canonical(q)));
});

test("curated alternative word orders are accepted and invalid content is rejected", () => {
  const s = {
    ...sense,
    assemblyAlternatives: { 0: ["to walk outside slowly"] },
  };
  assert(validAssemblyAlternatives(s));
  const q = makeAssemblyQuestion(s);
  assert(checkAssembly(q, ["w0", "w1", "w3", "w2"]));
  assert(!checkAssembly(q, ["w1", "w0", "w3", "w2"]));
  for (const alternatives of [
    null,
    [],
    { 2: [] },
    { "00": [] },
    { 0: ["to walk outside"] },
    { 0: ["to walk outside slowly."] },
    { 0: "to walk outside slowly" },
  ])
    assert(
      !validAssemblyAlternatives({
        ...sense,
        assemblyAlternatives: alternatives,
      }),
    );
  const state = emptyState();
  state.custom.push(s);
  assert.deepEqual(validateBackup(backup(state)).custom[0], s);
  state.custom[0].assemblyAlternatives["0"] = ["walk outside"];
  assert.throws(() => validateBackup(backup(state)), /추가 정답/);
});

test("format is fixed up front without changing queue size or the input", () => {
  for (let n = 1; n <= 30; n++) {
    const queue = Array.from({ length: n }, (_, i) => ({
      id: `sense-${i}`,
      kind: "new",
    }));
    const before = structuredClone(queue);
    for (const format of ["choice", "assembly", "mixed"]) {
      const result = formatQueue(queue, format, () => 0.42);
      assert.equal(result.length, n);
      assert.deepEqual(
        result.map((q) => q.id),
        queue.map((q) => q.id),
      );
      assert.equal(
        result.filter((q) => q.format === "assembly").length,
        format === "assembly"
          ? n
          : format === "mixed"
            ? Math.round(n * 0.3)
            : 0,
      );
    }
    assert.deepEqual(queue, before);
  }
});

test("three distinct first, unassisted correct days promote the next question", () => {
  const state = emptyState();
  assert.deepEqual(attempt(state, 1, true).qualifiedDates, ["2026-09-01"]);
  attempt(state, 1, true);
  attempt(state, 2, true, { assisted: true });
  attempt(state, 3, false);
  assert.deepEqual(attempt(state, 3, true).qualifiedDates, ["2026-09-01"]);
  attempt(state, 4, true);
  const currentQuestion = makeAssemblyQuestion(
    sense,
    {},
    state.progress[sense.id].assembly.level,
  );
  const mastery = attempt(state, 5, true);
  assert.equal(mastery.level, 1);
  assert.deepEqual(mastery.qualifiedDates, []);
  assert.equal(currentQuestion.level, 0);
  assert.equal(makeAssemblyQuestion(sense, {}, mastery.level).level, 1);
  assert.deepEqual(validateBackup(backup(state)).progress, state.progress);
});

test("two consecutive wrong challenges lower the next level, and success interrupts them", () => {
  const state = emptyState();
  for (const day of [1, 2, 3]) attempt(state, day, true);
  assert.equal(attempt(state, 4, false).wrongStreak, 1);
  assert.equal(attempt(state, 5, true).wrongStreak, 0);
  assert.equal(attempt(state, 6, false).level, 1);
  const a = attempt(state, 6, false);
  assert.equal(a.level, 0);
  assert.equal(a.wrongStreak, 0);
  assert.deepEqual(a.qualifiedDates, []);
  assert.equal(attempt(state, 7, false).level, 0);
});

test("mastery is per sense, capped at two extras, and easy practice preserves a higher level", () => {
  const state = emptyState();
  for (let day = 1; day <= 9; day++) attempt(state, day, true);
  const a = state.progress[sense.id].assembly;
  assert.equal(a.level, 2);
  assert.equal(a.qualifiedDates.length, 3);
  const before = [...a.qualifiedDates];
  attempt(state, 10, true, { level: 0 });
  attempt(state, 11, false, { level: 0 });
  assert.equal(a.level, 2);
  assert.deepEqual(a.qualifiedDates, before);
  const other = { ...sense, id: "custom-another-sense" };
  assert.equal(attempt(state, 12, true, {}, other).level, 0);
  assert.equal(a.level, 2);
  recordAnswer(state, other, true);
  assert.equal(state.progress[other.id].assembly.attempts, 1);
});

test("old backups default to choice; new settings and mastery survive with strict validation", () => {
  const state = emptyState();
  delete state.settings.format;
  delete state.settings.adaptiveAssembly;
  const old = validateBackup(backup(state));
  assert.equal(old.settings.format, "choice");
  assert.equal(old.settings.adaptiveAssembly, true);
  state.settings.format = "mixed";
  state.settings.adaptiveAssembly = false;
  attempt(state, 1, true);
  assert.deepEqual(validateBackup(backup(state)), state);
  for (const patch of [
    { level: 3 },
    { attempts: 2 },
    { right: 2 },
    { wrongStreak: 2 },
    { qualifiedDates: ["2026-09-01", "2026-09-01"] },
    { lastAttemptDate: "invalid" },
  ]) {
    const bad = structuredClone(state);
    Object.assign(bad.progress[sense.id].assembly, patch);
    assert.throws(() => validateBackup(backup(bad)), /문장 조립/);
  }
  state.settings.format = "constructor";
  assert.throws(() => validateBackup(backup(state)));
  state.settings.format = "choice";
  state.settings.adaptiveAssembly = "yes";
  assert.throws(() => validateBackup(backup(state)));
});

test("assembly speech reveals only the word until the answer has been submitted", () => {
  const q = makeAssemblyQuestion(sense);
  assert.deepEqual(quizSpeech(q, "question"), ["walk"]);
  assert.deepEqual(quizSpeech(q, "answer"), []);
  assert.deepEqual(quizSpeech(q, "choice-0"), []);
  assert.deepEqual(quizSpeech(q, "answer", true), [
    "walk",
    sense.definitions[0],
    "I walk to school.",
  ]);
});
