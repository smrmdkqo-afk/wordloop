import {
  LEVELS,
  DEFAULT_SETTINGS,
  MAX_DAILY_GOAL,
  emptyState,
  today,
  dateKey,
  planStudy,
  knownWords,
  makeQuestion,
  recordAnswer,
  removeAutomaticRetries,
  activeStreak,
  validateBackup,
  shuffle,
} from "./core.js";
import { read, write } from "./storage.js";
const $ = (s) => document.querySelector(s);
const escape = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const paths = {
  home: "M3 10l9-7 9 7v10H3z M9 20v-7h6v7",
  learn:
    "M4 4h6a3 3 0 0 1 3 3v14a5 5 0 0 0-4-2H4z M13 7a3 3 0 0 1 3-3h5v15h-4a5 5 0 0 0-4 2",
  words: "M6 3h13v18H6a3 3 0 0 1 0-6h13 M6 3a3 3 0 0 0-3 3v12 M9 7h6 M9 10h4",
  settings: "M4 6h16 M4 12h16 M4 18h16 M8 3v6 M16 9v6 M9 15v6",
  arrow: "M4 12h16 M14 6l6 6-6 6",
  chevron: "M9 5l7 7-7 7",
  repeat:
    "M4 8a8 8 0 0 1 13-3l3 3 M20 3v5h-5 M20 16a8 8 0 0 1-13 3l-3-3 M4 21v-5h5",
  check: "M5 12l4 4L19 6",
  close: "M6 6l12 12 M18 6L6 18",
  star: "M12 3l3 6 6 1-4.5 4.5 1 6.5-5.5-3-5.5 3 1-6.5L3 10l6-1z",
  search: "M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14 M15 15l6 6",
  plus: "M12 5v14 M5 12h14",
  leaf: "M20 3C5 2 1 11 6 17s15 0 14-14 M5 20L15 9",
  download: "M12 3v12 M7 10l5 5 5-5 M4 16v5h16v-5",
  spark: "M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z",
  flag: "M5 21V3 M5 4h14l-3 4 3 4H5",
  calendar: "M4 5h16v16H4z M8 3v4 M16 3v4 M4 10h16",
  book: "M5 3h14v18H5z M9 7h6 M9 11h6 M9 15h3",
};
const icon = (name, cls = "") =>
  `<svg class="icon ${cls}" aria-hidden="true" viewBox="0 0 24 24"><path d="${paths[name] || paths.book}"/></svg>`;
let state = emptyState(),
  bundle,
  all = [],
  byId = new Map(),
  session = null,
  lastQuestions = {},
  route = "home",
  busy = false,
  installPrompt,
  pageSize = 40;
let filters = { query: "", kind: "all", level: "all", mistake: "active" },
  selected = new Set();
let toastTimer,
  pendingBundle = null;
const nav = [
  ["home", "홈"],
  ["learn", "학습"],
  ["words", "단어장"],
  ["settings", "설정"],
];
function toast(message) {
  $("#toast").textContent = message;
  $("#toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("#toast").classList.remove("show"), 3500);
}
function rebuild() {
  all = [...bundle.senses, ...state.custom];
  byId = new Map(all.map((s) => [s.id, s]));
}
async function persist() {
  await write("snapshot", { state, session, lastQuestions });
}
function snapshot() {
  return structuredClone({ state, session, lastQuestions });
}
function restore(s) {
  ({ state, session, lastQuestions } = s);
  rebuild();
}
async function mutation(fn, refresh = true) {
  if (busy) return;
  busy = true;
  const before = snapshot();
  try {
    await fn();
    await persist();
    if (refresh) render();
    return true;
  } catch (e) {
    restore(before);
    toast("저장하지 못했어요. 기기의 저장 공간을 확인해 주세요.");
    console.error(e);
    render();
    return false;
  } finally {
    busy = false;
  }
}
function countWords(senses) {
  return new Set(senses.map((s) => s.word.toLowerCase())).size;
}
function badge(s) {
  return `<span class="badge">${LEVELS[s.level]}</span>`;
}
function example(s, index = 0, hidden = false) {
  return escape(s.examples[index % s.examples.length]).replace(
    "{}",
    hidden
      ? '<span class="blank">________</span>'
      : `<mark>${escape(s.word)}</mark>`,
  );
}
function progressCard(label, value, goal, iconName) {
  return `<div class="progress-card"><div class="ring" style="--amount:${Math.min(100, Math.round((value / goal) * 100))}%"><span>${icon(iconName)}</span></div><div><h3>${label}</h3><p><strong class="number">${value}</strong> / ${goal}${label.includes("단어") ? "개" : "문제"}</p></div></div>`;
}
function render() {
  route = location.hash.slice(1).split("?")[0] || "home";
  if (!nav.some((n) => n[0] === route)) route = "home";
  $("#navigation").innerHTML = nav
    .map(
      ([id, label]) =>
        `<a href="#${id}" class="nav-item ${route === id ? "active" : ""}" ${route === id ? 'aria-current="page"' : ""}>${icon(id)}<span>${label}</span></a>`,
    )
    .join("");
  $("#top-title").textContent = {
    home: "나의 학습 공간",
    learn: "오늘의 작은 반복",
    words: "쌓여가는 나의 단어들",
    settings: "나에게 맞는 학습",
  }[route];
  $("#main").innerHTML =
    route === "home"
      ? home()
      : route === "learn"
        ? learn()
        : route === "words"
          ? words()
          : settings();
  if (route === "words") renderList();
}
function heading(title, sub, extra = "") {
  return `<div class="heading"><div><h1>${title}</h1><p class="sub">${sub}</p></div>${extra}</div>`;
}
function empty(title, description, action = "") {
  return `<div class="empty">${icon("leaf")}<h2>${title}</h2><p>${description}</p>${action}</div>`;
}
function home() {
  const d = today(state),
    p = planStudy(state, all),
    known = knownWords(state, all).size,
    streak = activeStreak(state);
  const date = new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(new Date());
  const goalDone =
    d.newWords.length >= state.settings.dailyNew &&
    d.reviews.length >= state.settings.dailyReview;
  const week = Array.from({ length: 7 }, (_, i) => {
    const day = new Date();
    day.setDate(day.getDate() - 6 + i);
    const done = state.days[dateKey(day)]?.answers;
    return `<div class="week-day">${["일", "월", "화", "수", "목", "금", "토"][day.getDay()]}<span class="week-dot ${done ? "done" : ""} ${i === 6 ? "current" : ""}" aria-label="${day.getMonth() + 1}월 ${day.getDate()}일 ${done ? "학습 완료" : "학습 전"}">${done ? "✓" : day.getDate()}</span></div>`;
  }).join("");
  return `<div class="heading"><div><p class="date-label">${date}</p><h1>오늘도, 한 단어 더.</h1><p class="sub">쉬운 영어로 이해하고, 내 표현으로 기억해요.</p></div><span class="pill">${icon("leaf")} ${streak}일의 작은 습관</span></div>
 ${session && !session.complete ? `<div class="resume-banner"><span>학습 중인 ${session.queue.length - session.index}문제가 있어요.</span><a class="btn small" href="#learn">이어하기 ${icon("arrow")}</a></div>` : ""}
 <section class="hero"><div><div class="eyebrow">YOUR DAILY WORDLOOP</div><h2>${goalDone ? "오늘의 목표를<br>모두 채웠어요." : "작은 반복이 만드는<br>커다란 자신감."}</h2><p>${goalDone ? "차곡차곡 쌓인 오늘의 한 걸음." : "오늘의 단어를 나만의 속도로 익혀 보세요."}</p><button class="btn dark" data-action="start" data-mode="daily">${session && !session.complete ? "오늘 학습 이어하기" : p.fresh.length + p.review.length ? "오늘 학습 시작하기" : "더 공부하기"} ${icon("arrow")}</button></div><div class="hero-decor" aria-hidden="true"><div class="floating-word"><small>little by little</small><strong>grow.</strong><small>to become better, every day</small></div><span class="floating-tag">한 단어씩, 차곡차곡 ✓</span></div></section>
 <div class="progress-grid">${progressCard("오늘 새 단어", d.newWords.length, state.settings.dailyNew, "spark")}${progressCard("오늘 복습", d.reviews.length, state.settings.dailyReview, "repeat")}</div>
 <div class="section-title"><h2>조금 더 단단하게</h2><a href="#learn">학습 전체 보기 →</a></div><div class="quick-grid"><button class="quick-card" data-action="start" data-mode="mistakes"><span class="icon-box coral">${icon("repeat")}</span><span><strong>틀린 문제 다시 풀기</strong><small>${p.mistakes.length ? p.mistakes.length + "개의 뜻이 기다려요" : "아직 틀린 문제가 없어요"}</small></span>${icon("chevron")}</button><button class="quick-card" data-action="show-favorites"><span class="icon-box">${icon("star")}</span><span><strong>내가 모아둔 단어</strong><small>즐겨찾기 ${all.filter((s) => state.favorites.includes(s.id)).length}개</small></span>${icon("chevron")}</button></div>
 <div class="lower-grid"><section class="panel"><h3>일주일의 작은 발자국</h3><div class="week">${week}</div></section><section class="panel"><h3>내 안에 쌓이는 영어</h3><div class="vocab-total"><div><strong>${known}</strong><span>만나본 단어</span></div><div><strong>${Object.values(state.progress).filter((p) => p.streak >= 3).length}</strong><span>3일 이상 맞힌 뜻</span></div><div><strong>${countWords(all).toLocaleString()}</strong><span>전체 단어</span></div></div></section></div>`;
}
function learn() {
  if (session) {
    if (session.complete) return results();
    return quiz();
  }
  const p = planStudy(state, all);
  const card = (mode, title, desc, count, ico) =>
    `<button class="mode-card" data-action="start" data-mode="${mode}"><span class="icon-box ${mode === "mistakes" ? "coral" : ""}">${icon(ico)}</span><strong>${title}</strong><p>${desc}</p><span class="count">${count} ${icon("arrow")}</span></button>`;
  return (
    heading("어떤 반복을 해볼까요?", "오늘의 목표만큼, 혹은 한 걸음 더.") +
    `<div class="mode-grid">${card("new", "새 단어 배우기", "쉬운 영어 뜻을 익히고 문제로 확인해요.", p.fresh.length + "개 남음", "spark")}${card("review", "오늘의 복습", "복습할 때가 된 뜻을 다시 꺼내 봐요.", p.review.length + "문제 준비됨", "calendar")}${card("mistakes", "틀린 문제만", "헷갈렸던 뜻을 다른 예문과 보기로 만나요.", p.mistakes.length + "개 · 한 번에 최대 20개", "repeat")}${card("favorites", "즐겨찾기 학습", "기억하고 싶은 표현을 더 단단하게.", all.filter((s) => state.favorites.includes(s.id)).length + "개", "star")}</div><div class="notice">새 단어는 선택한 난이도에서 출제해요. 이미 배운 뜻의 복습은 난이도를 바꿔도 이어집니다.</div><button class="btn ghost wide" data-action="start" data-mode="extra">목표와 별도로 더 공부하기 ${icon("arrow")}</button>`
  );
}
function prepareQuestion() {
  const item = session.queue[session.index],
    s = byId.get(item.id);
  session.question = makeQuestion(
    s,
    byId,
    state.settings.mode,
    lastQuestions[s.id],
  );
  const q = session.question;
  lastQuestions[s.id] = {
    exampleIndex: q.exampleIndex,
    definitionIndex: q.definitionIndex,
    optionIds: q.optionIds,
    correctIndex: q.correctIndex,
  };
  session.answered = false;
  session.choice = null;
  session.revealed = false;
  session.showHint = false;
  session.phase = item.kind === "new" ? "learn" : "quiz";
}
async function start(mode, ids) {
  if (session && !session.complete && !ids && mode === "daily") {
    location.hash = "learn";
    return;
  }
  if (
    session &&
    !session.complete &&
    !confirm(
      "진도는 저장되어 있어요. 현재 학습 묶음을 마치고 새 학습을 시작할까요?",
    )
  )
    return;
  const p = planStudy(state, all);
  let queue = [];
  if (ids)
    queue = ids
      .filter((id) => byId.has(id))
      .map((id) => ({ id, kind: state.progress[id] ? "review" : "new" }));
  else if (mode === "daily")
    queue = [
      ...p.review.map((s) => ({ id: s.id, kind: "review" })),
      ...p.fresh.map((s) => ({ id: s.id, kind: "new" })),
    ];
  else if (mode === "new")
    queue = p.fresh.map((s) => ({ id: s.id, kind: "new" }));
  else if (mode === "review")
    queue = p.review.map((s) => ({ id: s.id, kind: "review" }));
  else if (mode === "mistakes")
    queue = shuffle(p.mistakes)
      .slice(0, 20)
      .map((s) => ({ id: s.id, kind: "review" }));
  else if (mode === "favorites")
    queue = shuffle(all.filter((s) => state.favorites.includes(s.id)))
      .slice(0, 20)
      .map((s) => ({
        id: s.id,
        kind: state.progress[s.id] ? "review" : "new",
      }));
  if (mode === "extra" || (mode === "daily" && !queue.length))
    queue = shuffle(all.filter((s) => state.settings.levels.includes(s.level)))
      .slice(0, 10)
      .map((s) => ({
        id: s.id,
        kind: state.progress[s.id] ? "review" : "new",
      }));
  if (!queue.length) {
    toast(
      mode === "mistakes"
        ? "복습할 틀린 문제가 없어요."
        : mode === "favorites"
          ? "단어장에 별표를 눌러 단어를 모아 보세요."
          : mode === "new"
            ? "오늘 목표를 채웠거나 선택한 수준을 모두 만났어요."
            : "지금 복습할 문제가 없어요.",
    );
    return;
  }
  const ok = await mutation(() => {
    session = {
      mode,
      queue,
      index: 0,
      initial: queue.length,
      attempts: 0,
      correct: 0,
      wrongIds: [],
      complete: false,
      startedAt: Date.now(),
    };
    prepareQuestion();
  }, false);
  if (ok) {
    if (location.hash === "#learn") render();
    else location.hash = "learn";
    window.scrollTo(0, 0);
  }
}
function quiz() {
  const q = session.question,
    s = q.sense,
    isLearning = session.phase === "learn";
  return `<section class="quiz"><div class="quiz-top"><button class="icon-button" data-action="pause" aria-label="학습 잠시 멈추기">${icon("close")}</button><span class="quiz-count">${isLearning ? "새 단어 익히기" : session.mode === "mistakes" ? "오답 복습" : "오늘의 학습"} · <strong>${session.index + 1}</strong> / ${session.queue.length}</span><span class="pill">${session.correct}개 정답</span></div><div class="bar" role="progressbar" aria-label="이번 학습 진행률" aria-valuenow="${session.index}" aria-valuemin="0" aria-valuemax="${session.queue.length}"><span style="width:${(session.index / session.queue.length) * 100}%"></span></div><div class="quiz-labels">${badge(s)}<span>${escape(s.pos)}</span></div>
 <article class="word-card"><button class="icon-button favorite ${state.favorites.includes(s.id) ? "on" : ""}" data-action="favorite" data-id="${s.id}" aria-label="즐겨찾기" aria-pressed="${state.favorites.includes(s.id)}">${icon("star")}</button>${isLearning || q.direction === "meaning" ? `<h1 class="word">${escape(s.word)}</h1>` : `<h1 class="definition-prompt">${escape(s.definitions[q.definitionIndex])}</h1>`}${isLearning ? `<p class="definition-prompt">${escape(s.definitions[q.definitionIndex])}</p>` : ""}<p class="sentence">${example(s, q.exampleIndex, !isLearning && q.direction === "word" && !session.answered)}</p><button class="hint" data-action="hint">${session.showHint ? escape(s.ko) : "한국어 힌트 보기"}</button></article>
 ${
   isLearning
     ? `<div class="notice">뜻을 이해했다면 예문을 한 번 읽어 보세요.<br>내일 다시 만나 오래 기억하도록 도와줄게요.</div><button class="btn primary wide" data-action="begin-question">이제 문제로 확인하기 ${icon("arrow")}</button>`
     : `<p class="prompt">${q.direction === "meaning" ? "이 문장에서 어떤 뜻일까요?" : "이 설명에 맞는 단어는 무엇일까요?"}</p>${
         q.recall
           ? recall(q)
           : `<div class="answers">${q.options
               .map((o, i) => {
                 const right = session.answered && o.id === s.id,
                   wrong =
                     session.answered &&
                     o.id === session.choice &&
                     o.id !== s.id;
                 return `<button class="answer ${right ? "correct" : ""} ${wrong ? "wrong" : ""}" data-action="answer" data-id="${o.id}" aria-disabled="${session.answered}"><span class="letter">${right ? "✓" : wrong ? "×" : ["A", "B", "C", "D"][i]}</span><span>${escape(o.text)}</span><span class="sr-only">${right ? "정답" : wrong ? "선택한 오답" : ""}</span></button>`;
               })
               .join("")}</div>`
       }${session.answered ? `<div class="feedback ${session.lastCorrect ? "" : "wrong"}" role="status"><strong>${session.lastCorrect ? "잘 기억하고 있어요." : "괜찮아요. 다시 만나면 더 익숙해져요."}</strong><p><b>${escape(s.word)}</b> · ${escape(s.definitions[q.definitionIndex])}</p><p>${session.lastCorrect ? "다음 복습 일정에 반영했어요." : state.settings.autoMistakes ? "틀린 문제장에 저장했어요." : "오답 자동 저장은 꺼져 있어요. 일반 복습에는 반영했어요."}</p></div><div class="quiz-actions"><button class="btn primary wide" data-action="next">${session.index + 1 === session.queue.length ? "학습 결과 보기" : "다음 문제"} ${icon("arrow")}</button></div>` : ""}`
 }</section>`;
}
function recall(q) {
  return `${!session.revealed && !session.answered ? `<button class="btn primary wide" data-action="reveal">정답 보기</button>` : `<div class="panel"><strong>${escape(q.direction === "word" ? q.sense.word : q.sense.definitions[0])}</strong></div>`}${session.revealed && !session.answered ? `<p class="prompt">직접 추가한 단어예요. 기억했는지 확인해 주세요.</p><div class="recall-actions"><button class="btn wide" data-action="self-answer" data-correct="false">다시 볼래요</button><button class="btn primary wide" data-action="self-answer" data-correct="true">알고 있어요</button></div>` : ""}`;
}
async function answer(id, self) {
  if (!session || session.answered || session.phase === "learn" || busy) return;
  const correct = self ?? id === session.question.sense.id;
  await mutation(() => {
    const s = session.question.sense,
      item = session.queue[session.index];
    recordAnswer(state, s, correct, { kind: item.kind });
    session.answered = true;
    session.choice = id;
    session.lastCorrect = correct;
    session.attempts++;
    if (correct) session.correct++;
    else if (!session.wrongIds.includes(s.id)) session.wrongIds.push(s.id);
  });
}
function results() {
  return `<section class="result"><div class="result-mark">${icon("check")}</div><div class="eyebrow">ONE LOOP CLOSER</div><h1>오늘의 반복이 쌓였어요.</h1><p class="sub">조금씩 익숙해지는 영어.<br>다음 복습에서 다시 만나요.</p><div class="result-stats"><div><strong>${session.initial}</strong><span>학습한 뜻</span></div><div><strong>${session.attempts}</strong><span>응답 횟수</span></div><div><strong>${Math.round((session.correct / session.attempts) * 100)}%</strong><span>전체 응답 정답률</span></div></div>${session.wrongIds.length ? `<button class="btn primary wide" data-action="retry-session">헷갈린 ${session.wrongIds.length}개 다시 풀기 ${icon("repeat")}</button>` : ""}<button class="btn ${session.wrongIds.length ? "" : "primary"} wide" data-action="finish">홈으로 돌아가기 ${icon("arrow")}</button><p class="saved-note">학습 기록을 이 기기에 저장했어요.</p></section>`;
}
function words() {
  return (
    heading(
      "나의 단어장",
      "단어의 뜻을 하나씩, 차곡차곡.",
      `<button class="btn small" data-action="add-word">${icon("plus")} 추가</button>`,
    ) +
    `<div class="toolbar"><label class="search">${icon("search")}<input id="word-search" type="search" placeholder="단어, 뜻 검색" aria-label="단어, 뜻 검색" value="${escape(filters.query)}"></label><select id="word-level" aria-label="난이도 필터"><option value="all">모든 난이도</option>${Object.entries(
      LEVELS,
    )
      .map(
        ([v, l]) =>
          `<option value="${v}" ${filters.level === v ? "selected" : ""}>${l}</option>`,
      )
      .join("")}</select></div><div class="chips">${[
      ["all", "전체"],
      ["favorites", "즐겨찾기"],
      ["mistakes", "틀린 문제"],
      ["custom", "내가 추가한 단어"],
    ]
      .map(
        ([k, l]) =>
          `<button class="chip ${filters.kind === k ? "active" : ""}" data-action="word-filter" data-kind="${k}" aria-pressed="${filters.kind === k}">${l}</button>`,
      )
      .join("")}</div>${
      filters.kind === "mistakes"
        ? `<div class="chips">${[
            ["active", "미해결"],
            ["resolved", "해결됨"],
          ]
            .map(
              ([k, l]) =>
                `<button class="chip ${filters.mistake === k ? "active" : ""}" data-action="mistake-filter" data-kind="${k}" aria-pressed="${filters.mistake === k}">${l}</button>`,
            )
            .join("")}</div>`
        : ""
    }<div id="word-results"></div>`
  );
}
function filtered() {
  const q = filters.query.trim().toLowerCase();
  return all.filter(
    (s) =>
      (filters.level === "all" || s.level === filters.level) &&
      (!q ||
        [s.word, s.ko, ...s.definitions].join(" ").toLowerCase().includes(q)) &&
      (filters.kind === "all" ||
        (filters.kind === "favorites" && state.favorites.includes(s.id)) ||
        (filters.kind === "mistakes" &&
          state.progress[s.id]?.mistake === filters.mistake) ||
        (filters.kind === "custom" && s.id.startsWith("custom-"))),
  );
}
function renderList() {
  const list = filtered();
  const showSelect = filters.kind === "mistakes";
  $("#word-results").innerHTML =
    `${showSelect && list.length ? `<div class="selection-bar"><label><input type="checkbox" id="select-all" ${list.every((s) => selected.has(s.id)) ? "checked" : ""}> 전체 선택</label><button class="btn small primary" data-action="practice-selected" ${selected.size ? "" : "disabled"}>선택한 ${selected.size}개 풀기</button></div>` : ""}<div class="list-meta"><span>${countWords(list).toLocaleString()}단어 · ${list.length.toLocaleString()}개의 뜻</span><span>별표로 모아두세요</span></div>${
      list.length
        ? `<div class="word-list">${list
            .slice(0, pageSize)
            .map((s) => {
              const p = state.progress[s.id];
              return `<div class="word-row">${showSelect ? `<input class="check-word" type="checkbox" data-select="${s.id}" aria-label="${escape(s.word)} 선택" ${selected.has(s.id) ? "checked" : ""}>` : ""}<button class="word-open" data-action="word-detail" data-id="${s.id}"><strong>${escape(s.word)}</strong>${badge(s)} ${p?.mistake === "active" ? '<span class="status mistake">복습 필요</span>' : p?.mistake === "resolved" ? '<span class="status">해결됨</span>' : ""}<p>${escape(s.definitions[0])}</p></button><button class="icon-button favorite ${state.favorites.includes(s.id) ? "on" : ""}" data-action="favorite" data-id="${s.id}" aria-label="${escape(s.word)} 즐겨찾기" aria-pressed="${state.favorites.includes(s.id)}">${icon("star")}</button></div>`;
            })
            .join(
              "",
            )}</div>${list.length > pageSize ? '<button class="btn load-more" data-action="more-words">더 보기</button>' : ""}`
        : empty(
            "아직 모아둔 단어가 없어요.",
            "검색 조건을 바꾸거나 새로운 단어를 추가해 보세요.",
          )
    }`;
}
function settings() {
  const st = state.settings;
  const row = (label, desc, control) =>
    `<div class="setting-row"><div class="setting-label"><span>${label}</span><p class="description">${desc}</p></div><div class="setting-control">${control}</div></div>`;
  return (
    heading("나에게 맞는 학습", "작은 목표부터, 편안하게 시작하세요.") +
    `<section class="setting-section"><h2>하루의 목표</h2>${row("새 단어", "같은 단어의 여러 뜻은 새 단어 1개로 세어요.", `<div><input class="input" id="daily-new" aria-label="하루 새 단어 수" type="number" min="1" max="${MAX_DAILY_GOAL}" value="${st.dailyNew}" data-setting="dailyNew"><span class="unit">개 / 하루</span></div>`)}${row("복습 문제", "그날 처음 복습한 뜻만 세어요. 반복 오답은 중복하지 않아요.", `<div><input class="input" id="daily-review" aria-label="하루 복습 문제 수" type="number" min="1" max="${MAX_DAILY_GOAL}" value="${st.dailyReview}" data-setting="dailyReview"><span class="unit">개 / 하루</span></div>`)}</section>
 <section class="setting-section"><h2>단어와 문제</h2>${row(
   "학습 난이도",
   "새로운 단어와 뜻을 만날 수준을 선택해요.",
   `<div class="level-choices">${Object.entries(LEVELS)
     .map(
       ([v, l]) =>
         `<label><input type="checkbox" name="levels" value="${v}" ${st.levels.includes(v) ? "checked" : ""}>${l}</label>`,
     )
     .join("")}</div>`,
 )}${row(
   "문제 방향",
   "다른 예문과 보기로 의미를 확인해요.",
   `<select aria-label="문제 방향" data-setting="mode">${[
     ["mixed", "두 가지 섞어서"],
     ["meaning", "단어 → 영어 뜻"],
     ["word", "영어 뜻 → 단어"],
   ]
     .map(
       ([v, l]) =>
         `<option value="${v}" ${st.mode === v ? "selected" : ""}>${l}</option>`,
     )
     .join("")}</select>`,
 )}</section>
 <section class="setting-section"><h2>틀린 문제 관리</h2>${row("오답 자동 저장", "끄면 새 오답을 문제장에 추가하지 않아요. 일반 복습과 기존 오답은 유지해요.", `<label class="switch"><input type="checkbox" aria-label="오답 자동 저장" data-setting="autoMistakes" ${st.autoMistakes ? "checked" : ""}><span></span></label>`)}${row("해결 처리 기준", "틀린 날 이후, 서로 다른 날에 맞힌 횟수예요. 다시 틀리면 처음부터 세어요.", `<select aria-label="오답 해결 처리 기준" data-setting="resolveDays">${[1, 2, 3, 4, 5].map((v) => `<option value="${v}" ${st.resolveDays === v ? "selected" : ""}>서로 다른 ${v}일 정답</option>`).join("")}</select>`)}</section>
 <section class="setting-section"><h2>내 단어장 보관하기</h2>${row("백업 및 복원", "기기를 바꾸거나 브라우저 데이터를 지우기 전에 백업해 주세요.", `<div class="data-actions"><button class="btn small" data-action="export">${icon("download")} 백업 저장</button><button class="btn small" data-action="import">불러오기</button><input id="backup-file" type="file" accept="application/json,.json" hidden></div>`)}${row("단어장 업데이트", `${countWords(bundle.senses).toLocaleString()}단어 · ${bundle.senses.length.toLocaleString()}개의 뜻`, '<button class="btn small" data-action="update">업데이트 확인</button>')}<p class="content-version">단어장 ${escape(bundle.version)} · ${navigator.onLine ? "온라인" : "오프라인"} · <span id="offline-state">오프라인 준비 확인 중</span></p></section>
 <section class="setting-section"><h2>앱으로 사용하기</h2>${row("홈 화면에 설치", "설치하면 휴대폰에서 앱처럼 열 수 있어요. 로그인은 필요 없어요.", '<button class="btn small" data-action="install">설치 안내</button>')}<p class="content-version">Wordloop 1.2.0 · 학습 기록은 이 기기에만 저장됩니다.<br><a href="./data/ATTRIBUTION.md" target="_blank" rel="noopener">단어장 출처·이용 조건</a></p></section>`
  );
}
function showDialog(html) {
  const d = $("#dialog");
  d.innerHTML = html;
  if (!d.open) d.showModal();
}
function closeDialog() {
  $("#dialog").close();
}
function detail(id) {
  const s = byId.get(id);
  if (!s) return;
  const p = state.progress[id];
  showDialog(
    `<div class="dialog-header"><span>${badge(s)} · ${escape(s.pos)}</span><button class="icon-button" data-action="close-dialog" aria-label="닫기">${icon("close")}</button></div><h2 class="word">${escape(s.word)}</h2><p class="definition">${escape(s.definitions[0])}</p>${s.examples.map((_, i) => `<p class="example sentence">${example(s, i)}</p>`).join("")}<details><summary class="hint">한국어 뜻 보기</summary><p>${escape(s.ko)}</p></details>${p ? `<p class="content-version">정답 ${p.right}회 · 오답 ${p.wrong}회<br>다음 복습: ${new Date(p.due).toLocaleDateString("ko-KR")}${p.mistake === "active" ? ` · 해결까지 ${p.resolvedDates.length}/${state.settings.resolveDays}일` : ""}</p>` : ""}<div class="actions"><button class="btn primary" data-action="practice-one" data-id="${id}">이 뜻 학습하기 ${icon("arrow")}</button>${id.startsWith("custom-") ? `<button class="btn" data-action="edit-word" data-id="${id}">수정</button><button class="btn danger" data-action="delete-word" data-id="${id}">삭제</button>` : ""}</div>`,
  );
}
function wordForm(id) {
  const s = byId.get(id) || {
    word: "",
    ko: "",
    definitions: [""],
    examples: [""],
    level: "beginner",
    pos: "other",
  };
  showDialog(
    `<div class="dialog-header"><h2>${id ? "내 단어 수정" : "내 단어 추가"}</h2><button class="icon-button" data-action="close-dialog" aria-label="닫기">${icon("close")}</button></div><form id="word-form" data-id="${id || ""}"><label class="field">영어 단어<input name="word" class="input" required maxlength="80" value="${escape(s.word)}" placeholder="borrow" autocomplete="off"></label><label class="field">쉬운 영어 뜻<textarea name="definition" required maxlength="500" rows="2" placeholder="to use something and give it back later">${escape(s.definitions[0])}</textarea></label><label class="field">예문<input name="example" class="input" required maxlength="700" value="${escape(s.examples[0].replace("{}", s.word))}" placeholder="Can I borrow your pen?"></label><label class="field">한국어 힌트<input name="ko" class="input" maxlength="200" value="${escape(s.ko)}" placeholder="빌리다"></label><div class="toolbar"><label class="field">난이도<select name="level">${Object.entries(
      LEVELS,
    )
      .map(
        ([v, l]) =>
          `<option value="${v}" ${s.level === v ? "selected" : ""}>${l}</option>`,
      )
      .join("")}</select></label><label class="field">품사<select name="pos">${[
      ["other", "기타"],
      ["noun", "명사"],
      ["verb", "동사"],
      ["adjective", "형용사"],
      ["adverb", "부사"],
    ]
      .map(
        ([v, l]) =>
          `<option value="${v}" ${s.pos === v ? "selected" : ""}>${l}</option>`,
      )
      .join(
        "",
      )}</select></label></div><p class="notice">추가한 단어는 정답을 떠올리는 카드로 학습해요. 예문에는 입력한 단어를 그대로 넣어 주세요.</p><button class="btn primary wide" type="submit">저장하기</button></form>`,
  );
}
async function refreshContent(manual = false) {
  try {
    const manifest = await fetch("./data/manifest.json", {
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    }).then((r) => {
      if (!r.ok) throw Error("manifest");
      return r.json();
    });
    if (
      manifest.schema !== 1 ||
      !Array.isArray(manifest.files) ||
      manifest.files.some(
        (f) =>
          !/^data\/[a-z0-9-]+\.json$/.test(f.path) ||
          !/^\w{64}$/.test(f.sha256),
      )
    )
      throw Error("Invalid catalog");
    if (bundle?.version === manifest.version) {
      if (manual) toast("이미 최신 단어장이에요.");
      return;
    }
    const packs = await Promise.all(
      manifest.files.map(async (f) => {
        const response = await fetch(
          "./" + f.path + "?v=" + f.sha256.slice(0, 12),
          { cache: "no-store", signal: AbortSignal.timeout(20000) },
        );
        if (!response.ok) throw Error("data");
        const raw = await response.text();
        const hash = Array.from(
          new Uint8Array(
            await crypto.subtle.digest(
              "SHA-256",
              new TextEncoder().encode(raw),
            ),
          ),
        )
          .map((x) => x.toString(16).padStart(2, "0"))
          .join("");
        if (hash !== f.sha256) throw Error("incomplete deployment");
        return JSON.parse(raw);
      }),
    );
    const senses = packs.flatMap((p) => p.senses);
    const ids = new Set(senses.map((s) => s.id));
    if (
      ids.size !== senses.length ||
      !senses.length ||
      senses.some(
        (s) =>
          !s.id ||
          !s.word ||
          !LEVELS[s.level] ||
          !s.definitions?.length ||
          !s.examples?.every((e) => e.includes("{}")) ||
          !s.distractors?.every((id) => ids.has(id)),
      )
    )
      throw Error("Invalid word data");
    const next = { version: manifest.version, senses };
    if (session && !session.complete) {
      pendingBundle = next;
      if (manual) toast("새 단어장을 찾았어요. 현재 학습을 마치면 적용해요.");
      return;
    }
    await write("content", next);
    bundle = next;
    state.contentVersion = bundle.version;
    rebuild();
    await persist();
    if (manual) toast("단어장을 업데이트했어요. 학습 기록은 그대로예요.");
    render();
  } catch (e) {
    if (!bundle) throw e;
    if (manual)
      toast(
        "업데이트를 확인하지 못했어요. 저장된 단어장으로 계속 학습할 수 있어요.",
      );
  }
}
async function finish() {
  await mutation(async () => {
    session = null;
    if (pendingBundle) {
      await write("content", pendingBundle);
      bundle = pendingBundle;
      pendingBundle = null;
      rebuild();
    }
  }, false);
  location.hash = "home";
  render();
}
function exportBackup() {
  const blob = new Blob(
    [
      JSON.stringify(
        {
          app: "wordloop",
          version: 1,
          exportedAt: new Date().toISOString(),
          state,
        },
        null,
        2,
      ),
    ],
    { type: "application/json" },
  );
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `wordloop-backup-${dateKey()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast("백업 파일을 저장했어요.");
}
async function importBackup(file) {
  if (!file) return;
  try {
    if (file.size > 10 * 1024 * 1024)
      throw Error("10MB 이하의 백업 파일을 선택해 주세요.");
    const next = validateBackup(JSON.parse(await file.text()));
    if (
      !confirm(
        "이 파일의 학습 기록과 설정으로 현재 기기의 기록을 바꿀까요? 기존 기록이 필요하면 먼저 백업해 주세요.",
      )
    )
      return;
    await mutation(() => {
      state = next;
      session = null;
      lastQuestions = {};
      rebuild();
    });
    toast("백업을 불러왔어요.");
  } catch (e) {
    toast(
      e instanceof SyntaxError ? "올바른 백업 파일이 아니에요." : e.message,
    );
  }
}
async function install() {
  if (installPrompt) {
    await installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
  } else {
    showDialog(
      `<div class="dialog-header"><h2>홈 화면에 워드루프</h2><button class="icon-button" data-action="close-dialog" aria-label="닫기">${icon("close")}</button></div><p class="sub">안드로이드 크롬: 메뉴(⋮) → <b>앱 설치</b> 또는 <b>홈 화면에 추가</b><br><br>아이폰 사파리: 공유 → <b>홈 화면에 추가</b></p><p class="notice">이미 설치했다면 홈 화면의 워드루프 아이콘으로 열어 주세요. 첫 실행과 단어장 업데이트에는 인터넷 연결이 필요해요.</p>`,
    );
  }
}
async function offlineLabel() {
  const el = $("#offline-state");
  if (!el) return;
  const keys = await (globalThis.caches?.keys() || Promise.resolve([])).catch(
    () => [],
  );
  el.textContent = keys.some((k) => k.startsWith("wordloop-"))
    ? "오프라인 사용 준비됨"
    : "첫 방문 준비 중 · 잠시 뒤 다시 확인";
}
window.addEventListener("hashchange", () => {
  render();
  window.scrollTo(0, 0);
  offlineLabel();
});
window.addEventListener("online", () => {
  toast("온라인으로 연결됐어요.");
  refreshContent();
});
window.addEventListener("offline", () =>
  toast("오프라인이에요. 저장된 단어장으로 계속 학습해요."),
);
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installPrompt = e;
});
document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-action]");
  if (!b || busy) return;
  const a = b.dataset.action,
    id = b.dataset.id;
  if (a === "start") await start(b.dataset.mode);
  else if (a === "favorite") {
    await mutation(() => {
      state.favorites = state.favorites.includes(id)
        ? state.favorites.filter((x) => x !== id)
        : [...state.favorites, id];
    });
  } else if (a === "hint") {
    session.showHint = !session.showHint;
    render();
  } else if (a === "begin-question") {
    await mutation(() => (session.phase = "quiz"));
    window.scrollTo(0, 0);
  } else if (a === "answer") {
    await answer(id);
    requestAnimationFrame(() =>
      $(".quiz-actions")?.scrollIntoView({ block: "end", behavior: "instant" }),
    );
  } else if (a === "self-answer") {
    await answer(null, b.dataset.correct === "true");
    requestAnimationFrame(() =>
      $(".quiz-actions")?.scrollIntoView({ block: "end", behavior: "instant" }),
    );
  } else if (a === "reveal") await mutation(() => (session.revealed = true));
  else if (a === "next") {
    await mutation(() => {
      session.index++;
      if (session.index >= session.queue.length) session.complete = true;
      else prepareQuestion();
    });
    window.scrollTo(0, 0);
  } else if (a === "pause") {
    location.hash = "home";
    toast("기록을 저장했어요. 언제든 이어서 학습하세요.");
  } else if (a === "finish") await finish();
  else if (a === "retry-session") {
    const ids = [...session.wrongIds];
    session = null;
    await start("mistakes", ids);
  } else if (a === "show-favorites") {
    filters.kind = "favorites";
    filters.query = "";
    location.hash = "words";
    render();
  } else if (a === "word-filter") {
    filters.kind = b.dataset.kind;
    selected.clear();
    pageSize = 40;
    render();
  } else if (a === "mistake-filter") {
    filters.mistake = b.dataset.kind;
    selected.clear();
    pageSize = 40;
    render();
  } else if (a === "more-words") {
    pageSize += 40;
    renderList();
  } else if (a === "word-detail") detail(id);
  else if (a === "practice-one") {
    closeDialog();
    await start("single", [id]);
  } else if (a === "practice-selected")
    await start(
      "mistakes",
      [...selected].filter((id) => filtered().some((s) => s.id === id)),
    );
  else if (a === "close-dialog") closeDialog();
  else if (a === "add-word") wordForm();
  else if (a === "edit-word") wordForm(id);
  else if (a === "delete-word") {
    if (
      session &&
      !session.complete &&
      session.queue.slice(session.index).some((q) => q.id === id)
    ) {
      toast("현재 학습 묶음에 있는 단어예요. 학습을 마친 뒤 삭제해 주세요.");
      return;
    }
    if (confirm("이 단어를 삭제할까요?")) {
      await mutation(() => {
        state.custom = state.custom.filter((s) => s.id !== id);
        state.favorites = state.favorites.filter((x) => x !== id);
        rebuild();
      });
      closeDialog();
    }
  } else if (a === "export") exportBackup();
  else if (a === "import") $("#backup-file").click();
  else if (a === "update") {
    b.disabled = true;
    b.textContent = "확인 중…";
    await refreshContent(true);
    render();
    offlineLabel();
  } else if (a === "install") install();
});
document.addEventListener("input", (e) => {
  if (e.target.id === "word-search") {
    filters.query = e.target.value;
    pageSize = 40;
    selected.clear();
    renderList();
  }
});
document.addEventListener("change", async (e) => {
  const el = e.target;
  if (el.id === "word-level") {
    filters.level = el.value;
    pageSize = 40;
    selected.clear();
    renderList();
  } else if (el.dataset.select) {
    if (el.checked) selected.add(el.dataset.select);
    else selected.delete(el.dataset.select);
    renderList();
  } else if (el.id === "select-all") {
    selected = el.checked ? new Set(filtered().map((s) => s.id)) : new Set();
    renderList();
  } else if (el.id === "backup-file") await importBackup(el.files[0]);
  else if (el.name === "levels") {
    const levels = [...document.querySelectorAll("[name=levels]:checked")].map(
      (x) => x.value,
    );
    if (!levels.length) {
      el.checked = true;
      toast("난이도를 하나 이상 선택해 주세요.");
      return;
    }
    await mutation(() => (state.settings.levels = levels));
    toast("학습 난이도를 저장했어요.");
  } else if (el.dataset.setting) {
    const key = el.dataset.setting;
    let value = el.type === "checkbox" ? el.checked : el.value;
    if (["dailyNew", "dailyReview", "resolveDays"].includes(key)) {
      value = Number(value);
      const max = key === "resolveDays" ? 5 : MAX_DAILY_GOAL;
      if (!Number.isInteger(value) || value < 1 || value > max) {
        el.value = state.settings[key];
        toast(`1~${max} 사이의 정수를 입력해 주세요.`);
        return;
      }
    }
    await mutation(() => {
      state.settings[key] = value;
      if (key === "resolveDays")
        for (const p of Object.values(state.progress))
          if (p.mistake === "active" && p.resolvedDates.length >= value)
            p.mistake = "resolved";
    });
    toast("설정을 저장했어요.");
    offlineLabel();
  }
});
document.addEventListener("submit", async (e) => {
  if (e.target.id !== "word-form") return;
  e.preventDefault();
  const form = e.target,
    fd = new FormData(form),
    word = fd.get("word").trim();
  if (!/^[A-Za-z][A-Za-z '\-]{0,79}$/.test(word)) {
    toast("영어 단어나 짧은 표현을 입력해 주세요.");
    return;
  }
  const pattern = new RegExp(
    "\\b" + word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b",
    "i",
  );
  const sentence = fd.get("example").trim();
  if (!pattern.test(sentence)) {
    toast("예문에 입력한 단어를 그대로 넣어 주세요.");
    return;
  }
  const s = {
    id: form.dataset.id || "custom-" + crypto.randomUUID(),
    word,
    ko: fd.get("ko").trim(),
    pos: fd.get("pos"),
    level: fd.get("level"),
    definitions: [fd.get("definition").trim()],
    examples: [sentence.replace(pattern, "{}")],
    distractors: [],
  };
  if (!s.definitions[0]) {
    toast("영어 뜻을 입력해 주세요.");
    return;
  }
  const ok = await mutation(() => {
    const i = state.custom.findIndex((x) => x.id === s.id);
    if (i >= 0) state.custom[i] = s;
    else state.custom.push(s);
    rebuild();
  });
  if (ok) {
    closeDialog();
    toast("내 단어장에 저장했어요.");
  }
});
async function boot() {
  try {
    const [saved, content] = await Promise.all([
      read("snapshot"),
      read("content"),
    ]);
    if (saved) {
      state = saved.state;
      state.settings = {
        ...structuredClone(DEFAULT_SETTINGS),
        ...state.settings,
      };
      session = saved.session;
      lastQuestions = saved.lastQuestions || {};
      if (Object.hasOwn(state.settings, "hideEnglish")) {
        delete state.settings.hideEnglish;
        await persist();
      }
    }
    bundle = content;
    if (bundle) {
      rebuild();
      if (removeAutomaticRetries(session)) {
        if (!session.complete && !session.question) prepareQuestion();
        await persist();
      }
      render();
      refreshContent();
    } else await refreshContent();
    if ("serviceWorker" in navigator)
      try {
        const registration = await navigator.serviceWorker.register("./sw.js");
        registration.addEventListener("updatefound", () => {
          const worker = registration.installing;
          worker?.addEventListener("statechange", () => {
            if (
              worker.state === "installed" &&
              navigator.serviceWorker.controller
            )
              toast(
                "앱 업데이트가 준비됐어요. 모든 워드루프 창을 닫고 다시 열면 적용돼요.",
              );
          });
        });
        navigator.serviceWorker.ready.then(offlineLabel);
      } catch (e) {
        console.warn("Offline setup pending", e);
        toast(
          "오프라인 준비를 완료하지 못했어요. 온라인 학습은 계속할 수 있어요.",
        );
      }
    if (navigator.storage?.persist) navigator.storage.persist();
    offlineLabel();
  } catch (e) {
    console.error(e);
    $("#main").innerHTML = empty(
      "단어장을 열지 못했어요.",
      "첫 실행에는 인터넷 연결과 브라우저 저장 공간이 필요해요. 새로고침해서 다시 시도해 주세요.",
      '<button class="btn primary" onclick="location.reload()">다시 시도하기</button>',
    );
  }
}
// Keep one writer per origin so simultaneous tabs cannot overwrite progress.
if (navigator.locks)
  navigator.locks.request(
    "wordloop-active",
    { ifAvailable: true },
    async (lock) => {
      if (!lock) {
        $("#main").innerHTML = empty(
          "다른 창에서 워드루프를 사용 중이에요.",
          "다른 워드루프 창을 닫은 뒤 이 창을 새로고침해 주세요.",
          '<button class="btn primary" onclick="location.reload()">다시 열기</button>',
        );
        return;
      }
      await boot();
      await new Promise(() => {});
    },
  );
else boot();
