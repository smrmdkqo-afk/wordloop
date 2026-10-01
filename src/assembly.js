export const FORMATS = Object.freeze({
  meaning: "단어 → 영어 뜻",
  word: "영어 뜻 → 단어",
  assembly: "영어 뜻 문장 조립",
  mixed: "섞어서 풀기",
});

const EXTRA_WORDS = [
  "always",
  "never",
  "quickly",
  "only",
  "before",
  "after",
  "again",
  "without",
  "another",
  "still",
  "often",
  "tomorrow",
  "yesterday",
  "almost",
  "already",
  "outside",
];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const words = (text) =>
  String(text).normalize("NFKC").trim().split(/\s+/).filter(Boolean);
const normalized = (text) =>
  words(text).join(" ").replace(/[‘’]/g, "'").toLowerCase();
const bag = (text) => words(normalized(text)).sort().join("\n");
function shuffled(values, random) {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// Optional alternatives are explicit, edited word orders for each definition.
// They must use exactly the same word pieces as that definition.
export function validAssemblyAlternatives(sense) {
  const alternatives = sense.assemblyAlternatives;
  if (alternatives === undefined) return true;
  if (
    !alternatives ||
    typeof alternatives !== "object" ||
    Array.isArray(alternatives)
  )
    return false;
  return Object.entries(alternatives).every(
    ([index, entries]) =>
      /^(0|[1-9]\d*)$/.test(index) &&
      Number(index) < sense.definitions.length &&
      Array.isArray(entries) &&
      entries.length <= 10 &&
      entries.every(
        (text) =>
          typeof text === "string" &&
          text.trim() &&
          text.length <= 500 &&
          bag(text) === bag(sense.definitions[Number(index)]),
      ),
  );
}

export function makeAssemblyQuestion(
  sense,
  previous = {},
  level = 0,
  random = Math.random,
) {
  const definitionIndex =
    ((previous.definitionIndex ?? -1) + 1) % sense.definitions.length;
  const exampleIndex =
    ((previous.exampleIndex ?? -1) + 1) % sense.examples.length;
  const text = sense.definitions[definitionIndex];
  const required = words(text);
  const present = new Set(
    required.map((word) => normalized(word).replace(/[^\p{L}\p{N}]/gu, "")),
  );
  const extras = shuffled(
    EXTRA_WORDS.filter((word) => !present.has(word)),
    random,
  ).slice(0, Math.max(0, Math.min(2, level)));
  let tokens = shuffled(
    [
      ...required.map((text, i) => ({ id: `w${i}`, text })),
      ...extras.map((text, i) => ({ id: `x${i}`, text })),
    ],
    random,
  );
  if (
    normalized(tokens.map((token) => token.text).join(" ")) ===
      normalized(text) &&
    tokens.length > 1
  )
    tokens.push(tokens.shift());
  return {
    type: "assembly",
    sense,
    direction: "meaning",
    definitionIndex,
    exampleIndex,
    recall: false,
    options: [],
    tokens,
    requiredCount: required.length,
    level: extras.length,
    acceptedOrders: [
      text,
      ...(sense.assemblyAlternatives?.[definitionIndex] || []),
    ]
      .filter((answer) => bag(answer) === bag(text))
      .map(normalized),
  };
}

export function assemblyText(question, selected) {
  const byId = new Map(question.tokens.map((token) => [token.id, token.text]));
  return selected
    .map((id) => byId.get(id))
    .filter(Boolean)
    .join(" ");
}
export function checkAssembly(question, selected) {
  if (
    selected.length !== question.requiredCount ||
    new Set(selected).size !== selected.length ||
    selected.some((id) => !question.tokens.some((token) => token.id === id))
  )
    return false;
  return question.acceptedOrders.includes(
    normalized(assemblyText(question, selected)),
  );
}
export function formatQueue(queue, format, random = Math.random) {
  const count =
    format === "assembly"
      ? queue.length
      : format === "mixed"
        ? Math.round(queue.length * 0.3)
        : 0;
  const assembly = new Set(
    shuffled(
      queue.map((_, i) => i),
      random,
    ).slice(0, count),
  );
  const choices = queue.map((_, i) => i).filter((i) => !assembly.has(i));
  const wordChoices = new Set(
    format === "mixed"
      ? shuffled(choices, random).slice(0, Math.floor(choices.length / 2))
      : [],
  );
  return queue.map((item, i) => {
    const isAssembly = assembly.has(i);
    return {
      ...item,
      format: isAssembly ? "assembly" : "choice",
      ...(!isAssembly
        ? {
            direction:
              format === "word" || wordChoices.has(i) ? "word" : "meaning",
          }
        : {}),
    };
  });
}

export function recordAssembly(
  progress,
  correct,
  { date, assisted = false, level = 0 },
) {
  const a = (progress.assembly ||= {
    level: 0,
    qualifiedDates: [],
    lastAttemptDate: null,
    wrongStreak: 0,
    attempts: 0,
    right: 0,
  });
  const firstToday = a.lastAttemptDate !== date;
  a.lastAttemptDate = date;
  a.attempts++;
  if (correct) {
    a.right++;
    a.wrongStreak = 0;
    if (
      firstToday &&
      !assisted &&
      level === a.level &&
      !a.qualifiedDates.includes(date)
    ) {
      a.qualifiedDates.push(date);
      if (a.qualifiedDates.length >= 3 && a.level < 2) {
        a.level++;
        a.qualifiedDates = [];
      } else a.qualifiedDates = a.qualifiedDates.slice(-3);
    }
  } else if (level > 0 && level === a.level) {
    a.wrongStreak++;
    if (a.wrongStreak >= 2) {
      a.level--;
      a.wrongStreak = 0;
      a.qualifiedDates = [];
    }
  } else a.wrongStreak = 0;
  return a;
}
export function validAssemblyProgress(a, progress) {
  return (
    a &&
    typeof a === "object" &&
    !Array.isArray(a) &&
    Number.isInteger(a.level) &&
    a.level >= 0 &&
    a.level <= 2 &&
    Number.isInteger(a.attempts) &&
    a.attempts >= 0 &&
    a.attempts <= progress.seen &&
    Number.isInteger(a.right) &&
    a.right >= 0 &&
    a.right <= a.attempts &&
    a.right <= progress.right &&
    Number.isInteger(a.wrongStreak) &&
    a.wrongStreak >= 0 &&
    a.wrongStreak <= 1 &&
    Array.isArray(a.qualifiedDates) &&
    a.qualifiedDates.length <= 3 &&
    new Set(a.qualifiedDates).size === a.qualifiedDates.length &&
    a.qualifiedDates.every(
      (date) => typeof date === "string" && DATE.test(date),
    ) &&
    (a.lastAttemptDate === null ||
      (typeof a.lastAttemptDate === "string" && DATE.test(a.lastAttemptDate)))
  );
}
