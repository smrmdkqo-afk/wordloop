// Speech interaction tests use a controllable engine; device voice quality needs
// a real phone/browser. Run after npm run build, with the smoke suite's runtime.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const server = spawn(process.execPath, ["scripts/serve.mjs"], {
  env: { ...process.env, PORT: "4391", SERVE_DIR: "dist" },
});
await new Promise((resolve, reject) => {
  server.stdout.once("data", resolve);
  server.once("error", reject);
  server.once("exit", () => reject(Error("Test server stopped")));
});
const browser = await chromium.launch({
  headless: true,
  ...(process.env.WORDLOOP_CHROMIUM_PATH
    ? { executablePath: process.env.WORDLOOP_CHROMIUM_PATH }
    : {}),
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
});
await context.addInitScript(() => {
  const engine = {
    calls: [],
    active: [],
    cancellations: 0,
    getVoices: () => [
      { name: "Test English", lang: "en-US", localService: true },
    ],
    speak(u) {
      this.calls.push({ text: u.text, rate: u.rate, lang: u.lang });
      this.active.push(u);
      u.onstart?.();
    },
    cancel() {
      this.cancellations++;
      const old = this.active.splice(0);
      // Browsers may send late cancellation callbacks after a new read starts.
      queueMicrotask(() =>
        old.forEach((u) => u.onerror?.({ error: "canceled" })),
      );
    },
    finish() {
      this.active.splice(0).forEach((u) => u.onend?.());
    },
    fail(error) {
      this.active[0]?.onerror?.({ error });
    },
  };
  window.__speech = engine;
  Object.defineProperty(window, "speechSynthesis", { value: engine });
  Object.defineProperty(window, "SpeechSynthesisUtterance", {
    value: class {
      constructor(text) {
        this.text = text;
      }
    },
  });
});
const page = await context.newPage(),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const base = "http://127.0.0.1:4391/";
const btn = (name) => page.getByRole("button", { name, exact: true });
const nav = async (name) => {
  await page.getByRole("link", { name, exact: true }).click();
  await page.waitForFunction(
    (label) =>
      document.querySelector(".nav-item.active")?.textContent.trim() === label,
    name,
  );
};
const state = () =>
  page.evaluate(async () => (await import("/src/storage.js")).read("snapshot"));
const calls = () => page.evaluate(() => window.__speech.calls);
const clear = () =>
  page.evaluate(() => {
    window.__speech.calls = [];
  });
const setting = async (key, value) => {
  const el = page.locator(`[data-setting="${key}"]`);
  if (typeof value === "boolean") await el.setChecked(value);
  else if (await el.evaluate((e) => e.tagName === "SELECT"))
    await el.selectOption(String(value));
  else {
    await el.fill(String(value));
    await el.press("Tab");
  }
  await page.waitForFunction(
    async ({ key, value }) =>
      (await (await import("/src/storage.js")).read("snapshot")).state.settings[
        key
      ] === value,
    { key, value },
  );
};
try {
  await page.goto(base);
  await nav("설정");
  await page.getByRole("heading", { name: "음성 읽기", exact: true }).waitFor();
  assert.equal(
    await page.getByLabel("문제 자동 읽기", { exact: true }).isChecked(),
    false,
  );
  await setting("mode", "word");
  await setting("dailyNew", 2);
  await setting("speechRate", 0.75);
  await btn("음성 미리 듣기").click();
  assert.equal((await calls())[0].rate, 0.75);
  await btn("읽기 중지").click();
  assert.equal(await page.evaluate(() => window.__speech.active.length), 0);
  await page.reload();
  await btn("음성 미리 듣기").waitFor();
  assert.equal(
    await page.getByLabel("읽기 속도", { exact: true }).inputValue(),
    "0.75",
  );
  assert.equal((await calls()).length, 0);
  await nav("홈");
  await btn("오늘 학습 시작하기").click();
  await btn("문제 듣기").waitFor();
  assert.equal((await calls()).length, 0);
  // Exercise both directions using a stable catalog question at phone sizes.
  // Reading icons must stay reachable without grading; normal phone viewports
  // show the complete question, four choices and unknown-answer action at once.
  const original = await state();
  for (const direction of ["word", "meaning"]) {
    await page.evaluate(
      async ({ original, direction }) => {
        const { read, write } = await import("/src/storage.js");
        const { makeQuestion } = await import("/src/core.js");
        const content = await read("content");
        const sense = content.senses.find((s) => s.word === "borrow");
        const saved = structuredClone(original);
        saved.session.queue[0].id = sense.id;
        saved.session.question = makeQuestion(
          sense,
          new Map(content.senses.map((s) => [s.id, s])),
          direction,
          {},
          () => 0.42,
        );
        await write("snapshot", saved);
      },
      { original, direction },
    );
    await page.reload();
    await btn("문제 듣기").waitFor();
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 360, height: 740 },
      { width: 320, height: 700 },
      { width: 1440, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      const bounds = await page.evaluate(() => {
        window.scrollTo(0, 0);
        const bottom =
          innerWidth <= 720
            ? document.querySelector("#navigation").getBoundingClientRect().top
            : innerHeight;
        return {
          contentBottom: document
            .querySelector(".unknown-answer")
            .getBoundingClientRect().bottom,
          availableBottom: bottom,
          fits:
            document.querySelector(".word-card").getBoundingClientRect().top >=
              0 &&
            document.querySelector(".unknown-answer").getBoundingClientRect()
              .bottom <= bottom,
          overflow: document.documentElement.scrollWidth > innerWidth,
          touchTargets: [
            ...document.querySelectorAll(".quiz .speech-icon"),
          ].every((el) => {
            const r = el.getBoundingClientRect();
            return r.width >= 44 && r.height >= 44;
          }),
          textFits: [
            ...document.querySelectorAll(".answer-text, .question-heading h1"),
          ].every((el) => {
            const range = document.createRange();
            range.selectNodeContents(el);
            const text = range.getBoundingClientRect();
            const container = el.closest(".answer-row, .word-card");
            const box = container.getBoundingClientRect();
            const speaker = container
              .querySelector(".speech-icon")
              .getBoundingClientRect();
            return (
              text.left >= box.left &&
              text.right <= speaker.left &&
              text.top >= box.top &&
              text.bottom <= box.bottom
            );
          }),
        };
      });
      if (viewport.width === 390) {
        await mkdir("test-results", { recursive: true });
        await page.screenshot({
          path: `test-results/compact-quiz-${direction}.png`,
        });
      }
      if (viewport.width >= 360)
        assert(
          bounds.fits,
          `${direction} ${viewport.width}x${viewport.height}: question/choices must fit above navigation: ${JSON.stringify(bounds)}`,
        );
      assert(
        !bounds.overflow && bounds.touchTargets && bounds.textFits,
        JSON.stringify({ direction, viewport, bounds }),
      );
    }
  }
  await page.evaluate(
    async (saved) => (await import("/src/storage.js")).write("snapshot", saved),
    original,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await btn("문제 듣기").waitFor();
  const before = await state(),
    q = before.session.question;
  await btn("문제 듣기").click();
  assert.deepEqual(
    (await calls()).map((c) => c.text),
    [
      q.sense.definitions[q.definitionIndex],
      q.sense.examples[q.exampleIndex].replace("{}", "blank"),
    ],
  );
  assert.equal(
    await page.locator('[data-read="question"]').getAttribute("aria-pressed"),
    "true",
  );
  assert.equal(await btn("정답·예문 듣기").count(), 0);
  let cancellations = await page.evaluate(() => window.__speech.cancellations);
  assert.equal(await page.locator(".quiz .speech-icon").count(), 5);
  assert.equal(await page.locator("button button").count(), 0);
  assert.equal(await btn("보기 듣기").count(), 0);
  for (let i = 0; i < 4; i++) {
    await clear();
    await btn(`${["A", "B", "C", "D"][i]} 보기 듣기`).click();
    assert.equal(
      await page.evaluate(() => window.__speech.cancellations),
      ++cancellations,
    );
    assert.deepEqual(
      (await calls()).map((c) => c.text),
      [q.options[i].text],
    );
    assert.equal(
      await page.locator('.quiz .speech-icon[aria-pressed="true"]').count(),
      1,
    );
    assert.deepEqual(await state(), before);
  }
  await btn("읽기 중지").click();
  assert.equal(await page.evaluate(() => window.__speech.active.length), 0);
  await clear();
  await btn("A 보기 듣기").focus();
  await page.keyboard.press("Space");
  assert.deepEqual(
    (await calls()).map((c) => c.text),
    [q.options[0].text],
  );
  assert.deepEqual(await state(), before);
  await btn("읽기 중지").press("Enter");
  assert.equal(await page.evaluate(() => window.__speech.active.length), 0);
  await btn("모르겠어요").click();
  await btn("정답·예문 듣기").waitFor();
  assert.equal(await page.evaluate(() => window.__speech.active.length), 0);
  assert.equal((await state()).session.queue.length, 2);
  await clear();
  await btn("정답·예문 듣기").click();
  assert.deepEqual(
    (await calls()).map((c) => c.text),
    [
      q.sense.word,
      q.sense.definitions[q.definitionIndex],
      q.sense.examples[q.exampleIndex].replace("{}", q.sense.word),
    ],
  );
  await btn("다음 문제").click();
  await page.waitForFunction(
    () => document.querySelector(".quiz-count strong")?.textContent === "2",
  );
  assert.equal(await page.evaluate(() => window.__speech.active.length), 0);
  await clear();
  await btn("문제 듣기").click();
  await page.evaluate(() => window.__speech.fail("not-allowed"));
  await page
    .getByText("읽기 버튼을 직접 눌러 음성을 시작해 주세요.", { exact: true })
    .waitFor();
  await btn("문제 듣기").click();
  await page.evaluate(() => window.__speech.finish());
  await btn("문제 듣기").waitFor();
  await nav("설정");
  await setting("autoRead", true);
  await setting("speechRate", 1.25);
  await page.reload();
  await btn("음성 미리 듣기").waitFor();
  assert.equal(
    await page.getByLabel("문제 자동 읽기", { exact: true }).isChecked(),
    true,
  );
  assert.equal(
    await page.getByLabel("읽기 속도", { exact: true }).inputValue(),
    "1.25",
  );
  assert.equal((await calls()).length, 0);
  await mkdir("test-results", { recursive: true });
  await page
    .getByRole("heading", { name: "음성 읽기", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/speech-settings-mobile.png" });
  await nav("학습");
  await page.getByRole("link", { name: "이어서 풀기", exact: true }).click();
  await btn("읽기 중지").waitFor();
  assert.equal((await calls()).length, 2);
  assert((await calls()).every((c) => c.rate === 1.25));
  await clear();
  await btn("즐겨찾기").click();
  await page.waitForFunction(
    () =>
      document.querySelector(".favorite")?.getAttribute("aria-pressed") ===
      "true",
  );
  await btn("한국어 힌트 보기").click();
  assert.equal((await calls()).length, 0);
  await nav("홈");
  assert.equal(await page.evaluate(() => window.__speech.active.length), 0);
  await btn("오늘 학습 이어하기").click();
  await btn("읽기 중지").waitFor();
  assert.equal((await calls()).length, 2);
  await btn("모르겠어요").click();
  await btn("학습 결과 보기").click();
  await page
    .getByRole("heading", { name: "오늘의 반복이 쌓였어요.", exact: true })
    .waitFor();
  assert.equal((await state()).session.attempts, 2);
  await clear();
  await btn("헷갈린 2개 다시 풀기").click();
  await btn("읽기 중지").waitFor();
  assert.equal((await calls()).length, 2);
  await clear();
  await btn("모르겠어요").click();
  await btn("다음 문제").click();
  await page.waitForFunction(
    () => document.querySelector(".quiz-count strong")?.textContent === "2",
  );
  assert.equal((await calls()).length, 2);
  assert.equal(await page.evaluate(() => window.__speech.active.length), 2);
  await page.screenshot({
    path: "test-results/speech-quiz-mobile.png",
    fullPage: true,
  });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.setViewportSize({ width: 320, height: 700 });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await nav("단어장");
  await page.locator('[data-action="word-detail"]').first().click();
  await clear();
  await btn("단어·예문 듣기").click();
  assert((await calls()).length >= 3);
  await page.keyboard.press("Escape");
  await page.locator("#dialog").waitFor({ state: "hidden" });
  assert.equal(await page.evaluate(() => window.__speech.active.length), 0);
  await page.locator('[data-action="word-detail"]').first().click();
  await clear();
  page.once("dialog", (d) => d.accept());
  await btn("이 뜻 학습하기").click();
  await btn("읽기 중지").waitFor();
  assert.equal((await calls()).length, 2);
  assert.equal(await page.evaluate(() => window.__speech.active.length), 2);
  assert.deepEqual(errors, []);

  const unsupported = await browser.newContext();
  await unsupported.addInitScript(() => {
    Object.defineProperty(window, "speechSynthesis", { value: undefined });
    Object.defineProperty(window, "SpeechSynthesisUtterance", {
      value: undefined,
    });
  });
  const other = await unsupported.newPage();
  other.on("pageerror", (e) => errors.push(e.message));
  await other.goto(base + "#settings");
  await other
    .getByText(
      "이 브라우저는 음성 읽기를 지원하지 않아요. 다른 브라우저에서 열어 주세요.",
      { exact: true },
    )
    .waitFor();
  assert(
    await other.getByRole("button", { name: "음성 미리 듣기" }).isDisabled(),
  );
  assert(
    await other.getByLabel("문제 자동 읽기", { exact: true }).isDisabled(),
  );
  await other.getByRole("link", { name: "홈", exact: true }).click();
  await other.getByRole("button", { name: "오늘 학습 시작하기" }).click();
  await other.getByRole("button", { name: "모르겠어요" }).click();
  await other.getByRole("button", { name: "다음 문제" }).waitFor();
  assert.deepEqual(errors, []);
  await unsupported.close();
  console.log(
    "Speech browser checks passed: individual choice icons, touch/keyboard playback without grading, both directions fit 360/390px phones, 320/1440px layout, manual/auto reading, speed persistence, blank safety, stop/replacement, fixed question count, dialogs, unsupported engine.",
  );
} finally {
  await browser.close();
  server.kill();
}
