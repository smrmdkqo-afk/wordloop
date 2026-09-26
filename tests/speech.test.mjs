import test from "node:test";
import assert from "node:assert/strict";
import { createSpeaker, quizSpeech } from "../src/speech.js";
import { emptyState, validateBackup } from "../src/core.js";

const question = {
  sense: {
    word: "borrow",
    definitions: ["to take and return", "to use something and give it back"],
    examples: ["Can I {} your pen?", "May I {} your book?"],
  },
  direction: "word",
  definitionIndex: 1,
  exampleIndex: 1,
  options: ["buy", "borrow", "lend", "sell"].map((text) => ({ text })),
};

test("question speech uses the selected sense/example and conceals unanswered blanks", () => {
  assert.deepEqual(quizSpeech(question, "question"), [
    "to use something and give it back",
    "May I blank your book?",
  ]);
  assert.deepEqual(quizSpeech(question, "answer"), []);
  assert.deepEqual(quizSpeech(question, "answer", true), [
    "borrow",
    "to use something and give it back",
    "May I borrow your book?",
  ]);
  assert.deepEqual(quizSpeech(question, "question", true), [
    "to use something and give it back",
    "May I borrow your book?",
  ]);
});

test("meaning questions do not speak the correct definition before answering", () => {
  assert.deepEqual(
    quizSpeech({ ...question, direction: "meaning" }, "question"),
    ["borrow", "May I borrow your book?"],
  );
});

test("each choice reads only its visible text, including after shuffling", () => {
  for (const options of [question.options, [...question.options].reverse()]) {
    for (let i = 0; i < options.length; i++)
      assert.deepEqual(quizSpeech({ ...question, options }, `choice-${i}`), [
        options[i].text,
      ]);
  }
  for (const kind of ["choices", "choice--1", "choice-4", "choice-0x"])
    assert.deepEqual(quizSpeech(question, kind), []);
  assert.deepEqual(quizSpeech({ ...question, recall: true }, "choice-0"), []);
});

function fixture(voices = []) {
  const queued = [],
    errors = [],
    changes = [];
  const synth = {
    cancellations: 0,
    getVoices: () => voices,
    speak: (utterance) => queued.push(utterance),
    cancel() {
      this.cancellations++;
    },
  };
  class Utterance {
    constructor(text) {
      this.text = text;
    }
  }
  let speaker;
  speaker = createSpeaker({
    synth,
    Utterance,
    onChange: () => changes.push(speaker.key),
    onError: (error) => errors.push(error),
  });
  return { speaker, synth, queued, errors, changes };
}

test("voice selection prefers local English and applies the chosen speed", () => {
  const local = { lang: "en-GB", localService: true };
  const f = fixture([
    { lang: "ko-KR", default: true },
    { lang: "en-US", default: true },
    local,
  ]);
  try {
    assert(f.speaker.read(["Hello", "World"], { key: "question", rate: 0.75 }));
    assert.equal(f.queued.length, 2);
    assert(
      f.queued.every(
        (u) => u.voice === local && u.lang === "en-GB" && u.rate === 0.75,
      ),
    );
    f.queued[0].onstart();
    f.queued[0].onend();
    assert.equal(f.speaker.key, "question");
    f.queued[1].onend();
    assert.equal(f.speaker.key, null);
    assert.deepEqual(f.errors, []);
  } finally {
    f.speaker.stop();
  }
});

test("replacement and manual stop cancel queued speech and ignore stale events", () => {
  const f = fixture();
  try {
    f.speaker.read(["first"], { key: "question" });
    const first = f.queued[0];
    const cancelled = f.synth.cancellations;
    f.speaker.read(["second"], { key: "choices" });
    assert.equal(f.synth.cancellations, cancelled + 1);
    first.onend();
    first.onerror({ error: "interrupted" });
    assert.equal(f.speaker.key, "choices");
    f.speaker.stop();
    f.queued[1].onerror({ error: "canceled" });
    assert.equal(f.speaker.key, null);
    assert.deepEqual(f.errors, []);
  } finally {
    f.speaker.stop();
  }
});

test("an initially empty voice list works and later available voices are picked up", () => {
  const voices = [],
    f = fixture(voices);
  try {
    f.speaker.read(["hello"], { key: "question" });
    assert.equal(f.queued[0].lang, "en-US");
    assert.equal(f.queued[0].voice, undefined);
    voices.push({ lang: "en-US", localService: true });
    f.speaker.read(["again"], { key: "question" });
    assert.equal(f.queued[1].voice, voices[0]);
  } finally {
    f.speaker.stop();
  }
});

test("long custom definitions split into bounded chunks without losing words", () => {
  const f = fixture(),
    long = "A useful example sentence. ".repeat(30).trim();
  try {
    f.speaker.read([long], { key: "detail", rate: 99 });
    assert(f.queued.every((u) => u.text.length <= 180 && u.rate === 1));
    assert.equal(f.queued.map((u) => u.text).join(" "), long);
  } finally {
    f.speaker.stop();
  }
});

test("unsupported and failed playback report an error without blocking learning", () => {
  const errors = [];
  const unsupported = createSpeaker({
    synth: null,
    Utterance: null,
    onError: (e) => errors.push(e),
  });
  assert.equal(unsupported.supported, false);
  assert.equal(unsupported.read(["hello"]), false);
  assert.deepEqual(errors, ["unsupported"]);
  const f = fixture();
  try {
    f.speaker.read(["hello"], { key: "question" });
    f.queued[0].onerror({ error: "not-allowed" });
    assert.equal(f.speaker.key, null);
    assert.deepEqual(f.errors, ["not-allowed"]);
    f.synth.speak = () => {
      throw Error("engine failure");
    };
    assert.equal(f.speaker.read(["retry"], { key: "question" }), false);
    assert.deepEqual(f.errors, ["not-allowed", "unavailable"]);
  } finally {
    f.speaker.stop();
  }
});

test("an engine that never starts resets the playback state", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture();
  f.speaker.read(["hello"], { key: "question" });
  t.mock.timers.tick(8000);
  assert.equal(f.speaker.key, null);
  assert.deepEqual(f.errors, ["unavailable"]);
  f.speaker.stop();
});

test("old backups receive safe defaults and new voice preferences survive restore", () => {
  const backup = { app: "wordloop", version: 1, state: emptyState() };
  delete backup.state.settings.autoRead;
  delete backup.state.settings.speechRate;
  const old = validateBackup(backup);
  assert.equal(old.settings.autoRead, false);
  assert.equal(old.settings.speechRate, 1);
  backup.state.settings.autoRead = true;
  backup.state.settings.speechRate = 1.25;
  assert.equal(validateBackup(backup).settings.autoRead, true);
  assert.equal(validateBackup(backup).settings.speechRate, 1.25);
  backup.state.settings.speechRate = "1.25";
  assert.throws(() => validateBackup(backup));
  backup.state.settings.speechRate = 1;
  backup.state.settings.autoRead = "yes";
  assert.throws(() => validateBackup(backup));
});
