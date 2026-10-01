import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyState,
  migrateStudySettings,
  validateBackup,
} from "../src/core.js";
import { formatQueue } from "../src/assembly.js";

test("separate legacy preferences migrate to one method without changing other settings", () => {
  for (const direction of ["meaning", "word", "mixed"]) {
    for (const format of [undefined, "choice", "assembly", "mixed"]) {
      const settings = { ...emptyState().settings, mode: direction };
      if (format === undefined) delete settings.format;
      else settings.format = format;
      const remaining = structuredClone(settings);
      delete remaining.mode;
      delete remaining.format;
      assert(migrateStudySettings(settings));
      assert.equal(
        settings.format,
        format === "assembly" || format === "mixed" ? format : direction,
      );
      assert.equal(Object.hasOwn(settings, "mode"), false);
      const actual = structuredClone(settings);
      delete actual.format;
      assert.deepEqual(actual, remaining);
      assert.equal(migrateStudySettings(settings), false);
    }
  }
});

test("legacy unfinished sessions retain their original choice mode and saved queue/question", () => {
  for (const mode of ["meaning", "word", "mixed"]) {
    const settings = { ...emptyState().settings, format: "choice", mode };
    const session = {
      complete: false,
      index: 1,
      attempts: 1,
      correct: 0,
      queue: [
        { id: "a", kind: "new", format: "choice" },
        { id: "b", kind: "new", format: "choice" },
      ],
      question: {
        direction: "meaning",
        sense: { id: "b" },
        options: ["saved", "options"],
      },
    };
    const before = structuredClone(session);
    migrateStudySettings(settings, session);
    assert.equal(session.choiceMode, mode);
    const { choiceMode, ...unchanged } = session;
    assert.deepEqual(unchanged, before);
    settings.format = "assembly";
    migrateStudySettings(settings, session);
    assert.equal(session.choiceMode, mode);
    assert.deepEqual(session.question, before.question);
    assert.deepEqual(session.queue, before.queue);
  }
});

test("older queues without formats and mixed queues preserve their choice direction", () => {
  const settings = { ...emptyState().settings, mode: "word", format: "mixed" };
  const session = {
    complete: false,
    queue: [{ id: "a", format: "assembly" }, { id: "b" }],
  };
  migrateStudySettings(settings, session);
  assert.equal(session.choiceMode, "word");
  assert.equal(session.queue[1].format, undefined);
  const assemblyOnly = {
    complete: false,
    queue: [{ id: "a", format: "assembly" }],
  };
  assert.equal(migrateStudySettings(settings, assemblyOnly), false);
  assert.equal(assemblyOnly.choiceMode, undefined);
});

test("new queues freeze both directions and mix ten questions as 4 meaning, 3 word, 3 assembly", () => {
  const queue = Array.from({ length: 10 }, (_, i) => ({
    id: `sense-${i}`,
    kind: "review",
  }));
  for (const format of ["meaning", "word", "assembly", "mixed"]) {
    const result = formatQueue(queue, format, () => 0.42);
    const session = { complete: false, queue: result };
    assert.equal(
      migrateStudySettings({ ...emptyState().settings, format }, session),
      false,
    );
    assert.equal(session.choiceMode, undefined);
    if (format === "mixed") {
      assert.equal(result.filter((q) => q.format === "assembly").length, 3);
      assert.equal(result.filter((q) => q.direction === "meaning").length, 4);
      assert.equal(result.filter((q) => q.direction === "word").length, 3);
    } else if (format !== "assembly")
      assert(
        result.every((q) => q.direction === format && q.format === "choice"),
      );
    const settings = { ...emptyState().settings, format: "assembly" };
    migrateStudySettings(settings, session);
    assert.deepEqual(session.queue, result);
  }
  assert(
    queue.every((q) => q.direction === undefined && q.format === undefined),
  );
});

test("both generations of backup restore the selected method and reject malformed methods", () => {
  for (const format of ["meaning", "word", "assembly", "mixed"]) {
    const state = emptyState();
    state.settings.format = format;
    assert.deepEqual(
      validateBackup({ app: "wordloop", version: 1, state }),
      state,
    );
  }
  for (const mode of ["meaning", "word", "mixed"]) {
    const state = emptyState();
    state.settings.mode = mode;
    state.settings.format = "choice";
    let result = validateBackup({ app: "wordloop", version: 1, state });
    assert.equal(result.settings.format, mode);
    assert.equal(Object.hasOwn(result.settings, "mode"), false);
    delete state.settings.format;
    result = validateBackup({ app: "wordloop", version: 1, state });
    assert.equal(result.settings.format, mode);
  }
  for (const patch of [
    { format: "constructor" },
    { format: "choice" },
    { format: null },
    { mode: "unknown" },
  ]) {
    const state = emptyState();
    Object.assign(state.settings, patch);
    assert.throws(() => validateBackup({ app: "wordloop", version: 1, state }));
  }
});
