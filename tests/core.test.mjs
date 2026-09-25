import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import {
  emptyState,
  recordAnswer,
  planStudy,
  today,
  dateKey,
  makeQuestion,
  validateBackup,
  activeStreak,
  removeAutomaticRetries,
} from "../src/core.js";
process.env.TZ = "Asia/Seoul";
const at = (d) => new Date(`2026-09-${d}T10:00:00+09:00`).getTime();
const senses = [];
for (const f of await readdir("data"))
  if (f.endsWith(".json") && f !== "manifest.json")
    senses.push(...JSON.parse(await readFile("data/" + f, "utf8")).senses);
const byId = new Map(senses.map((s) => [s.id, s]));
const book = senses.find((s) => s.word === "book" && s.pos === "noun");
const bookVerb = senses.find(
  (s) => s.word === "book" && s.level === "intermediate" && s.pos === "verb",
);
const borrow = senses.find((s) => s.word === "borrow");
test("catalog contains 4,062+ unique words, 4,200 meanings and two examples each", () => {
  assert(new Set(senses.map((s) => s.word)).size >= 4062);
  assert(senses.length >= 4200);
  assert(senses.every((s) => s.examples.length >= 2));
});
test("September expansion adds 3,000 distinct words without replacing existing senses", () => {
  const added = senses.filter((s) => s.id.endsWith("-exp-202609"));
  const previous = senses.filter((s) => !s.id.endsWith("-exp-202609"));
  const known = new Set(previous.map((s) => s.word.toLowerCase()));
  assert.equal(added.length, 3000);
  assert.equal(new Set(added.map((s) => s.word.toLowerCase())).size, 3000);
  assert(previous.length >= 1200);
  for (const s of added) {
    assert(!known.has(s.word.toLowerCase()), s.word);
    assert(s.examples.length >= 2, s.id);
    assert.equal(new Set(s.examples).size, s.examples.length, s.id);
    assert(
      s.examples.every((e) => e.split("{}").length === 2),
      s.id,
    );
    assert(s.distractors.length >= 4, s.id);
    assert(/[가-힣]/.test(s.ko), s.id);
    assert(s.source, s.id);
    for (const id of s.distractors) {
      const distractor = byId.get(id);
      assert(distractor, id);
      assert.equal(distractor.pos, s.pos, s.id);
      assert.notEqual(distractor.word, s.word, s.id);
      assert.notEqual(distractor.definitions[0], s.definitions[0], s.id);
    }
  }
});
test("all catalog questions have four unique choices and retain their answer when varied", () => {
  for (const sense of senses)
    for (const mode of ["meaning", "word"]) {
      const first = makeQuestion(sense, byId, mode, {}, () => 0.42),
        second = makeQuestion(sense, byId, mode, first, () => 0.42);
      assert.equal(first.options.length, 4, sense.id);
      assert.equal(new Set(first.options.map((o) => o.text)).size, 4, sense.id);
      assert.equal(
        new Set(second.options.map((o) => o.text)).size,
        4,
        sense.id,
      );
      assert(first.options.some((o) => o.id === sense.id));
      assert.notEqual(first.exampleIndex, second.exampleIndex);
      assert.notEqual(first.correctIndex, second.correctIndex);
      assert(
        second.optionIds.some((id) => !first.optionIds.includes(id)),
        sense.id,
      );
    }
});
test("learning another sense on another day does not count as a new word", () => {
  const s = emptyState();
  recordAnswer(s, book, true, { now: at(25), kind: "new" });
  recordAnswer(s, bookVerb, true, { now: at(26), kind: "new" });
  assert.equal(today(s, "2026-09-25").newWords.length, 1);
  assert.equal(today(s, "2026-09-26").newWords.length, 0);
  assert.deepEqual(today(s, "2026-09-26").reviews, [bookVerb.id]);
});
test("new-word selection is unique and obeys remaining daily quota", () => {
  const s = emptyState();
  s.settings.dailyNew = 2;
  s.settings.levels = ["beginner", "intermediate", "advanced"];
  recordAnswer(s, borrow, true, { kind: "new", now: at(25) });
  const plan = planStudy(s, senses, at(25));
  assert.equal(plan.fresh.length, 1);
  assert.notEqual(plan.fresh[0].word, "borrow");
});
test("repeated errors do not inflate daily unique progress", () => {
  const s = emptyState();
  recordAnswer(s, book, false, { now: at(25), kind: "new" });
  recordAnswer(s, book, false, { now: at(25) + 1, kind: "review" });
  recordAnswer(s, book, true, { now: at(25) + 2, kind: "review" });
  const d = today(s, "2026-09-25");
  assert.equal(d.newWords.length, 1);
  assert.equal(d.reviews.length, 0);
  assert.equal(d.answers, 3);
  assert.equal(s.progress[book.id].mistake, "active");
});
test("mistakes resolve only after correct answers on different later days", () => {
  const s = emptyState();
  recordAnswer(s, book, false, { now: at(25), kind: "new" });
  recordAnswer(s, book, true, { now: at(25) + 1 });
  assert.equal(s.progress[book.id].resolvedDates.length, 0);
  recordAnswer(s, book, true, { now: at(26) });
  recordAnswer(s, book, true, { now: at(26) + 1 });
  assert.equal(s.progress[book.id].mistake, "active");
  assert.equal(s.progress[book.id].resolvedDates.length, 1);
  recordAnswer(s, book, true, { now: at(27) });
  assert.equal(s.progress[book.id].mistake, "resolved");
  recordAnswer(s, book, false, { now: at(28) });
  assert.equal(s.progress[book.id].mistake, "active");
  assert.equal(s.progress[book.id].resolvedDates.length, 0);
});
test("disabling mistake notebook keeps ordinary review and existing mistakes", () => {
  const s = emptyState();
  s.settings.autoMistakes = false;
  recordAnswer(s, book, false, { now: at(25), kind: "new" });
  assert.equal(s.progress[book.id].mistake, null);
  assert.equal(s.progress[book.id].wrong, 1);
  assert(s.progress[book.id].due > at(25));
  s.settings.autoMistakes = true;
  recordAnswer(s, book, false, { now: at(26) });
  s.settings.autoMistakes = false;
  recordAnswer(s, book, false, { now: at(27) });
  assert.equal(s.progress[book.id].mistake, "active");
});
test("changing difficulty preserves due reviews from earlier levels", () => {
  const s = emptyState();
  recordAnswer(s, borrow, true, { now: at(25), kind: "new" });
  s.settings.levels = ["advanced"];
  const p = planStudy(s, senses, at(26));
  assert(p.review.some((q) => q.id === borrow.id));
  assert(p.fresh.every((q) => q.level === "advanced"));
});
test("review cap counts unique senses and a fresh day gets a fresh allowance", () => {
  const s = emptyState();
  s.settings.dailyReview = 1;
  recordAnswer(s, book, false, { now: at(24), kind: "new" });
  recordAnswer(s, borrow, false, { now: at(24), kind: "new" });
  assert.equal(planStudy(s, senses, at(25)).review.length, 1);
  recordAnswer(s, book, true, { now: at(25) });
  assert.equal(planStudy(s, senses, at(25)).review.length, 0);
  assert.equal(planStudy(s, senses, at(26)).review.length, 1);
});
test("spaced intervals do not advance through repeated same-day answers", () => {
  const s = emptyState();
  recordAnswer(s, book, true, { now: at(25), kind: "new" });
  const due = s.progress[book.id].due;
  recordAnswer(s, book, true, { now: at(25) + 1 });
  assert.equal(s.progress[book.id].streak, 1);
  assert.equal(s.progress[book.id].due, due);
  recordAnswer(s, book, true, { now: at(26) });
  assert.equal(s.progress[book.id].streak, 2);
  assert.equal(dateKey(new Date(s.progress[book.id].due)), "2026-09-29");
});
test("local calendar and streak survive a midnight boundary", () => {
  assert.equal(dateKey(new Date("2026-09-24T15:01:00Z")), "2026-09-25");
  const s = emptyState();
  recordAnswer(s, book, true, { now: at(24), kind: "new" });
  recordAnswer(s, book, true, { now: at(25) });
  assert.equal(activeStreak(s, new Date(at(26))), 2);
  assert.equal(activeStreak(s, new Date(at(27))), 0);
});
test("backup roundtrip preserves records; malformed backups are rejected", () => {
  const s = emptyState();
  recordAnswer(s, book, false, { now: at(25), kind: "new" });
  s.favorites = [book.id];
  const envelope = { app: "wordloop", version: 1, state: s };
  assert.deepEqual(validateBackup(JSON.parse(JSON.stringify(envelope))), s);
  for (const bad of [
    {},
    { ...envelope, version: 99 },
    { ...envelope, state: { ...s, settings: { ...s.settings, dailyNew: -1 } } },
    {
      ...envelope,
      state: {
        ...s,
        progress: { [book.id]: { ...s.progress[book.id], seen: 999 } },
      },
    },
  ])
    assert.throws(() => validateBackup(bad));
});
test("custom cards without authored distractors use recall instead of guessing options", () => {
  const q = makeQuestion(
    { ...book, id: "custom-a", distractors: [] },
    byId,
    "word",
  );
  assert.equal(q.recall, true);
  assert.equal(q.options.length, 0);
});
test("daily goals allow 300 words and reviews and honor remaining quota", () => {
  const s = emptyState();
  s.settings.dailyNew = 300;
  s.settings.dailyReview = 300;
  s.settings.levels = Object.keys({
    beginner: 1,
    intermediate: 1,
    advanced: 1,
  });
  const first = planStudy(s, senses, at(24));
  assert.equal(first.fresh.length, 300);
  for (const sense of first.fresh)
    recordAnswer(s, sense, true, { kind: "new", now: at(24) });
  assert.equal(planStudy(s, senses, at(24)).fresh.length, 0);
  const next = planStudy(s, senses, at(25));
  assert.equal(next.fresh.length, 300);
  assert.equal(next.review.length, 300);
  recordAnswer(s, next.review[0], true, { kind: "review", now: at(25) });
  assert.equal(planStudy(s, senses, at(25)).review.length, 299);
});
test("backups preserve 300-item goals", () => {
  const s = emptyState();
  s.settings.dailyNew = 300;
  s.settings.dailyReview = 300;
  const envelope = { app: "wordloop", version: 1, state: s };
  assert.deepEqual(validateBackup(envelope), s);
  for (const invalid of [{ dailyNew: 301 }, { dailyReview: 301 }])
    assert.throws(() =>
      validateBackup({
        ...envelope,
        state: { ...s, settings: { ...s.settings, ...invalid } },
      }),
    );
});
test("old backups discard the removed visibility setting without losing learning history", () => {
  const s = emptyState();
  recordAnswer(s, book, false, { kind: "new", now: at(25) });
  s.settings.hideEnglish = true;
  const restored = validateBackup({ app: "wordloop", version: 1, state: s });
  assert.equal(Object.hasOwn(restored.settings, "hideEnglish"), false);
  assert.deepEqual(restored.progress, s.progress);
  assert.deepEqual(restored.days, s.days);
});
test("upgrading a session removes retries and preserves an answered original question", () => {
  const question = { sense: { id: "b" } };
  const session = {
    queue: [
      { id: "a" },
      { id: "a", retry: true },
      { id: "b" },
      { id: "c" },
      { id: "b", retry: true },
    ],
    index: 2,
    initial: 3,
    attempts: 3,
    correct: 1,
    wrongIds: ["a", "b"],
    answered: true,
    choice: "c",
    question,
    complete: false,
  };
  assert.equal(removeAutomaticRetries(session), true);
  assert.deepEqual(
    session.queue.map((item) => item.id),
    ["a", "b", "c"],
  );
  assert.equal(session.index, 1);
  assert.equal(session.initial, 3);
  assert.equal(session.attempts, 2);
  assert.equal(session.correct, 0);
  assert.equal(session.question, question);
  assert.equal(session.choice, "c");
  assert.equal(session.answered, true);
  const saved = structuredClone(session);
  assert.equal(removeAutomaticRetries(session), false);
  assert.deepEqual(session, saved);
});
test("upgrading at an automatic retry advances to the next original question", () => {
  const session = {
    queue: [{ id: "a" }, { id: "a", retry: true }, { id: "b" }],
    index: 1,
    initial: 2,
    attempts: 1,
    correct: 0,
    wrongIds: ["a"],
    answered: false,
    question: { sense: { id: "a" } },
    complete: false,
  };
  removeAutomaticRetries(session);
  assert.equal(session.index, 1);
  assert.equal(session.queue[session.index].id, "b");
  assert.equal(session.question, null);
  assert.equal(session.answered, false);
  assert.equal(session.complete, false);
  assert.equal(session.attempts, 1);
});
test("upgrading finishes a session when only automatic retries remain", () => {
  const session = {
    queue: [
      { id: "a" },
      { id: "b" },
      { id: "a", retry: true },
      { id: "b", retry: true },
    ],
    index: 3,
    initial: 2,
    attempts: 4,
    correct: 2,
    wrongIds: ["a", "b"],
    answered: true,
    question: { sense: { id: "b" } },
    complete: false,
  };
  removeAutomaticRetries(session);
  assert.equal(session.complete, true);
  assert.equal(session.index, 2);
  assert.equal(session.attempts, 2);
  assert.equal(session.correct, 0);
  assert.deepEqual(session.wrongIds, ["a", "b"]);
  assert.equal(removeAutomaticRetries(null), false);
});
