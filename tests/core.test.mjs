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
test("catalog contains 1,000+ unique words, 1,200 meanings and two examples each", () => {
  assert(new Set(senses.map((s) => s.word)).size >= 1000);
  assert(senses.length >= 1200);
  assert(senses.every((s) => s.examples.length >= 2));
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
