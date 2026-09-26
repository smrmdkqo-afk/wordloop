export const SPEECH_RATES = Object.freeze([0.75, 1, 1.25, 1.5]);

// Read the visible question, never fill in an unanswered word-direction blank.
export function quizSpeech(question, kind, revealed = false) {
  const { sense, direction, definitionIndex, exampleIndex } = question;
  const definition = sense.definitions[definitionIndex];
  const sentence = sense.examples[exampleIndex % sense.examples.length];
  if (kind === "answer")
    return revealed
      ? [sense.word, definition, sentence.replace("{}", sense.word)]
      : [];
  const choice = /^choice-([0-3])$/.exec(kind);
  if (choice) {
    const option = question.options?.[Number(choice[1])];
    return !question.recall && option ? [option.text] : [];
  }
  if (kind !== "question") return [];
  return [
    direction === "meaning" ? sense.word : definition,
    sentence.replace(
      "{}",
      direction === "word" && !revealed ? "blank" : sense.word,
    ),
  ];
}

function chunks(parts) {
  const result = [];
  for (const part of parts) {
    let line = String(part || "")
      .replace(/\s+/g, " ")
      .trim();
    while (line.length > 180) {
      const space = line.lastIndexOf(" ", 180);
      const end = space > 0 ? space : 180;
      result.push(line.slice(0, end));
      line = line.slice(end).trim();
    }
    if (line) result.push(line);
  }
  return result;
}

export function createSpeaker({
  synth = globalThis.speechSynthesis,
  Utterance = globalThis.SpeechSynthesisUtterance,
  onChange = () => {},
  onError = () => {},
} = {}) {
  const supported = Boolean(
    synth &&
    typeof synth.speak === "function" &&
    typeof Utterance === "function",
  );
  let generation = 0,
    key = null,
    utterances = [],
    startTimer;
  function stop() {
    generation++;
    clearTimeout(startTimer);
    key = null;
    utterances = [];
    if (supported) synth.cancel();
    onChange();
  }
  function read(parts, { key: nextKey, rate = 1 } = {}) {
    stop();
    if (!supported) {
      onError("unsupported");
      return false;
    }
    const lines = chunks(parts);
    if (!lines.length) return false;
    const run = generation;
    function fail(reason) {
      if (run !== generation) return;
      stop();
      onError(reason);
    }
    try {
      // Prefer a device English voice; a remote English voice is also usable.
      // Empty voice lists are normal on first use: lang lets the browser choose.
      const english = (synth.getVoices?.() || []).filter((v) =>
        /^en(?:[-_]|$)/i.test(v.lang),
      );
      const voice =
        english.find((v) => v.localService && v.default) ||
        english.find((v) => v.localService) ||
        english.find((v) => v.default) ||
        english[0];
      key = nextKey;
      utterances = lines.map((text, index) => {
        const utterance = new Utterance(text);
        utterance.lang = voice?.lang || "en-US";
        if (voice) utterance.voice = voice;
        utterance.rate = SPEECH_RATES.includes(rate) ? rate : 1;
        utterance.onstart = () => {
          if (run === generation) clearTimeout(startTimer);
        };
        utterance.onend = () => {
          if (run !== generation || index !== lines.length - 1) return;
          clearTimeout(startTimer);
          key = null;
          utterances = [];
          onChange();
        };
        utterance.onerror = (event) => fail(event.error || "unavailable");
        return utterance;
      });
      onChange();
      startTimer = setTimeout(() => fail("unavailable"), 8000);
      // Queue the entire batch in the user's interaction, keeping references
      // until completion. Stop/replacement invalidates all old callbacks.
      for (const utterance of utterances) {
        if (run !== generation) break;
        synth.speak(utterance);
      }
      return run === generation;
    } catch {
      fail("unavailable");
      return false;
    }
  }
  return {
    supported,
    read,
    stop,
    get key() {
      return key;
    },
  };
}
