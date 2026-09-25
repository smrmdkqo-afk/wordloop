export const LEVELS = {
  beginner: "초급",
  intermediate: "중급",
  advanced: "고급",
};
export const MAX_DAILY_GOAL = 300;
export const DEFAULT_SETTINGS = Object.freeze({
  dailyNew: 10,
  dailyReview: 20,
  levels: ["beginner", "intermediate"],
  mode: "mixed",
  autoMistakes: true,
  resolveDays: 2,
});
export function dateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function emptyState() {
  return {
    schema: 1,
    settings: structuredClone(DEFAULT_SETTINGS),
    progress: {},
    days: {},
    favorites: [],
    custom: [],
    contentVersion: null,
  };
}
export function today(state, key = dateKey()) {
  return (
    state.days[key] || {
      newWords: [],
      newSenses: [],
      reviews: [],
      answers: 0,
      correct: 0,
    }
  );
}
export function knownWords(state, senses) {
  return new Set(
    senses
      .filter((s) => state.progress[s.id]?.seen > 0)
      .map((s) => s.word.toLowerCase()),
  );
}
export function planStudy(state, senses, now = Date.now()) {
  const day = today(state, dateKey(new Date(now)));
  const known = knownWords(state, senses);
  const seenWords = new Set(known);
  const fresh = [];
  for (const s of senses.filter((s) =>
    state.settings.levels.includes(s.level),
  )) {
    const word = s.word.toLowerCase();
    if (!seenWords.has(word)) {
      fresh.push(s);
      seenWords.add(word);
    }
  }
  const done = new Set(day.reviews);
  const review = senses
    .filter((s) => {
      if (done.has(s.id)) return false;
      const p = state.progress[s.id];
      if (p?.seen) return p.due <= now;
      return (
        known.has(s.word.toLowerCase()) &&
        state.settings.levels.includes(s.level) &&
        !day.newWords.includes(s.word.toLowerCase())
      );
    })
    .sort(
      (a, b) =>
        (state.progress[a.id]?.due ?? now) - (state.progress[b.id]?.due ?? now),
    );
  return {
    fresh: fresh.slice(
      0,
      Math.max(0, state.settings.dailyNew - day.newWords.length),
    ),
    review: review.slice(
      0,
      Math.max(0, state.settings.dailyReview - day.reviews.length),
    ),
    availableNew: fresh.length,
    availableReview: review.length,
    mistakes: senses.filter((s) => state.progress[s.id]?.mistake === "active"),
  };
}
export function shuffle(values, random = Math.random) {
  const a = [...values];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
// Keep an in-progress session's original questions when upgrading from auto-retry.
export function removeAutomaticRetries(session) {
  if (!session || session.complete || !session.queue.some((item) => item.retry))
    return false;
  const current = session.queue[session.index];
  const answeredOriginal = !current?.retry && session.answered;
  const index = session.queue
    .slice(0, session.index)
    .filter((item) => !item.retry).length;
  session.queue = session.queue.filter((item) => !item.retry);
  session.index = index;
  session.initial = session.queue.length;
  // Only first attempts belong to this fixed-size session. The full learning
  // history already saved in state.progress/state.days remains untouched.
  session.attempts = index + (answeredOriginal ? 1 : 0);
  session.correct = Math.max(0, session.attempts - session.wrongIds.length);
  session.complete = index >= session.queue.length;
  if (current?.retry) {
    session.question = null;
    session.answered = false;
  }
  return true;
}
export function makeQuestion(
  sense,
  byId,
  mode,
  previous = {},
  random = Math.random,
) {
  const direction =
    mode === "mixed" ? (random() < 0.5 ? "meaning" : "word") : mode;
  const exampleIndex =
    ((previous.exampleIndex ?? -1) + 1) % sense.examples.length;
  const definitionIndex =
    ((previous.definitionIndex ?? -1) + 1) % sense.definitions.length;
  let candidates = sense.distractors.map((id) => byId.get(id)).filter(Boolean);
  if (candidates.length < 3)
    return {
      sense,
      direction,
      exampleIndex,
      definitionIndex,
      recall: true,
      options: [],
    };
  const previousIds = new Set(previous.optionIds || []);
  candidates = [
    ...shuffle(
      candidates.filter((s) => !previousIds.has(s.id)),
      random,
    ),
    ...shuffle(
      candidates.filter((s) => previousIds.has(s.id)),
      random,
    ),
  ];
  const distinct = new Set([sense.word]);
  candidates = candidates.filter((s) => {
    if (distinct.has(s.word)) return false;
    distinct.add(s.word);
    return true;
  });
  let options = shuffle([sense, ...candidates.slice(0, 3)], random).map(
    (s) => ({
      id: s.id,
      text:
        direction === "word"
          ? s.word
          : s.definitions[definitionIndex % s.definitions.length],
    }),
  );
  if (
    previous.correctIndex !== undefined &&
    options.findIndex((s) => s.id === sense.id) === previous.correctIndex
  )
    options.push(options.shift());
  return {
    sense,
    direction,
    exampleIndex,
    definitionIndex,
    recall: false,
    options,
    optionIds: options.filter((s) => s.id !== sense.id).map((s) => s.id),
    correctIndex: options.findIndex((s) => s.id === sense.id),
  };
}
export function recordAnswer(
  state,
  sense,
  correct,
  { now = Date.now(), kind = "review" } = {},
) {
  const key = dateKey(new Date(now));
  const day = (state.days[key] ||= {
    newWords: [],
    newSenses: [],
    reviews: [],
    answers: 0,
    correct: 0,
  });
  const wordKnown = Object.values(state.progress).some(
    (p) => p.seen > 0 && p.word === sense.word.toLowerCase(),
  );
  const p = (state.progress[sense.id] ||= {
    seen: 0,
    right: 0,
    wrong: 0,
    streak: 0,
    due: now,
    mistake: null,
    resolvedDates: [],
    firstSeen: now,
  });
  p.word = sense.word.toLowerCase();
  if (!p.seen && !wordKnown && kind === "new") {
    if (!day.newWords.includes(sense.word.toLowerCase()))
      day.newWords.push(sense.word.toLowerCase());
    if (!day.newSenses.includes(sense.id)) day.newSenses.push(sense.id);
  } else if (
    !day.newSenses.includes(sense.id) &&
    !day.reviews.includes(sense.id)
  )
    day.reviews.push(sense.id);
  day.answers++;
  p.seen++;
  p.lastSeen = now;
  if (correct) {
    p.right++;
    day.correct++;
    if (p.lastCorrectDate !== key) {
      p.streak++;
      const interval = [1, 3, 7, 14, 30, 60][Math.min(p.streak - 1, 5)];
      const due = new Date(now);
      due.setDate(due.getDate() + interval);
      due.setHours(0, 0, 0, 0);
      p.due = due.getTime();
    } else if (p.due <= now + 600000) {
      const due = new Date(now);
      due.setDate(due.getDate() + 1);
      due.setHours(0, 0, 0, 0);
      p.due = due.getTime();
    }
    p.lastCorrectDate = key;
    if (
      p.mistake === "active" &&
      p.lastWrongDate !== key &&
      !p.resolvedDates.includes(key)
    ) {
      p.resolvedDates.push(key);
      if (p.resolvedDates.length >= state.settings.resolveDays) {
        p.mistake = "resolved";
        p.resolvedAt = now;
      }
    }
  } else {
    p.wrong++;
    p.streak = 0;
    p.due = now + 600000;
    p.lastWrongDate = key;
    p.resolvedDates = [];
    if (state.settings.autoMistakes || p.mistake) p.mistake = "active";
  }
  return p;
}
export function activeStreak(state, now = new Date()) {
  const d = new Date(now);
  d.setHours(12, 0, 0, 0);
  if (!state.days[dateKey(d)]?.answers) d.setDate(d.getDate() - 1);
  let count = 0;
  while (state.days[dateKey(d)]?.answers) {
    count++;
    d.setDate(d.getDate() - 1);
  }
  return count;
}
export function validateBackup(input) {
  if (
    !input ||
    input.app !== "wordloop" ||
    input.version !== 1 ||
    !input.state ||
    input.state.schema !== 1
  )
    throw new Error("워드루프 백업 파일이 아니에요.");
  const s = input.state;
  const isObject = (o) => o && typeof o === "object" && !Array.isArray(o);
  if (
    !isObject(s.settings) ||
    !isObject(s.progress) ||
    !isObject(s.days) ||
    !Array.isArray(s.favorites) ||
    !Array.isArray(s.custom)
  )
    throw new Error("백업 구조가 올바르지 않아요.");
  for (const [k, lo, hi] of [
    ["dailyNew", 1, MAX_DAILY_GOAL],
    ["dailyReview", 1, MAX_DAILY_GOAL],
    ["resolveDays", 1, 5],
  ])
    if (
      !Number.isInteger(s.settings[k]) ||
      s.settings[k] < lo ||
      s.settings[k] > hi
    )
      throw new Error("백업의 학습 설정을 확인해 주세요.");
  if (
    !Array.isArray(s.settings.levels) ||
    !s.settings.levels.length ||
    s.settings.levels.some((l) => !Object.hasOwn(LEVELS, l)) ||
    !["mixed", "meaning", "word"].includes(s.settings.mode) ||
    typeof s.settings.autoMistakes !== "boolean"
  )
    throw new Error("백업의 학습 설정을 확인해 주세요.");
  const idOK = (x) =>
    typeof x === "string" &&
    /^[a-z0-9][a-z0-9_-]{0,100}$/.test(x) &&
    !["constructor", "prototype", "__proto__"].includes(x);
  if (s.favorites.some((x) => !idOK(x)) || s.custom.length > 5000)
    throw new Error("백업의 단어 목록을 확인해 주세요.");
  const customIds = new Set();
  for (const c of s.custom) {
    if (
      !isObject(c) ||
      !idOK(c.id) ||
      !c.id.startsWith("custom-") ||
      customIds.has(c.id) ||
      typeof c.word !== "string" ||
      c.word.length > 80 ||
      !c.word.trim() ||
      typeof c.ko !== "string" ||
      c.ko.length > 200 ||
      !["noun", "verb", "adjective", "adverb", "other"].includes(c.pos) ||
      !Object.hasOwn(LEVELS, c.level) ||
      !Array.isArray(c.definitions) ||
      !c.definitions.length ||
      c.definitions.some(
        (d) => typeof d !== "string" || !d.trim() || d.length > 500,
      ) ||
      !Array.isArray(c.examples) ||
      !c.examples.length ||
      c.examples.some(
        (e) => typeof e !== "string" || !e.includes("{}") || e.length > 700,
      ) ||
      !Array.isArray(c.distractors) ||
      c.distractors.some((x) => !idOK(x))
    )
      throw new Error("직접 추가한 단어의 형식이 올바르지 않아요.");
    customIds.add(c.id);
  }
  for (const [id, p] of Object.entries(s.progress)) {
    if (
      !idOK(id) ||
      !isObject(p) ||
      ![
        "seen",
        "right",
        "wrong",
        "streak",
        "due",
        "firstSeen",
        "lastSeen",
      ].every((k) => Number.isFinite(p[k]) && p[k] >= 0) ||
      p.seen !== p.right + p.wrong ||
      ![null, "active", "resolved"].includes(p.mistake) ||
      !Array.isArray(p.resolvedDates) ||
      p.resolvedDates.some((d) => !/^\d{4}-\d{2}-\d{2}$/.test(d))
    )
      throw new Error("백업의 학습 기록을 확인해 주세요.");
  }
  for (const [date, d] of Object.entries(s.days)) {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !isObject(d) ||
      !["newWords", "newSenses", "reviews"].every(
        (k) =>
          Array.isArray(d[k]) &&
          d[k].every((v) => typeof v === "string" && v.length < 120),
      ) ||
      !Number.isInteger(d.answers) ||
      !Number.isInteger(d.correct) ||
      d.answers < 0 ||
      d.correct < 0 ||
      d.correct > d.answers
    )
      throw new Error("백업의 날짜별 기록을 확인해 주세요.");
  }
  const clean = emptyState();
  for (const k of Object.keys(clean))
    if (Object.hasOwn(s, k)) clean[k] = structuredClone(s[k]);
  clean.settings = { ...structuredClone(DEFAULT_SETTINGS), ...clean.settings };
  delete clean.settings.hideEnglish;
  return clean;
}
