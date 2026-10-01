// Run after npm run build, with the same Playwright runtime as browser-smoke.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const server = spawn(process.execPath, ["scripts/serve.mjs"], {
  env: { ...process.env, PORT: "4392", SERVE_DIR: "dist" },
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
  timezoneId: "Asia/Seoul",
});
await context.addInitScript(() => {
  window.__speechCalls = [];
  Object.defineProperty(window, "speechSynthesis", {
    value: {
      getVoices: () => [{ lang: "en-US", localService: true }],
      cancel() {},
      speak(u) {
        window.__speechCalls.push(u.text);
        u.onstart?.();
        queueMicrotask(() => u.onend?.());
      },
    },
  });
  Object.defineProperty(window, "SpeechSynthesisUtterance", {
    value: class {
      constructor(text) {
        this.text = text;
      }
    },
  });
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const base = "http://127.0.0.1:4392/";
const btn = (name) => page.getByRole("button", { name, exact: true });
const saved = () =>
  page.evaluate(async () => (await import("/src/storage.js")).read("snapshot"));
const nav = async (name) => {
  await page.getByRole("link", { name, exact: true }).click();
  await page.waitForFunction(
    (label) =>
      document.querySelector(".nav-item.active")?.textContent.trim() === label,
    name,
  );
};
const setting = async (key, value) => {
  const input = page.locator(`[data-setting="${key}"]`);
  if (typeof value === "boolean") await input.setChecked(value);
  else await input.selectOption(value);
  await page.waitForFunction(
    async ({ key, value }) =>
      (await (await import("/src/storage.js")).read("snapshot")).state.settings[
        key
      ] === value,
    { key, value },
  );
};
const select = async (id) => {
  await page.locator(`[data-action="assembly-add"][data-id="${id}"]`).click();
  await page.waitForFunction(
    async (id) =>
      (
        await (await import("/src/storage.js")).read("snapshot")
      ).session.selectedTokens.includes(id),
    id,
  );
};
const canonical = (q) =>
  q.tokens
    .filter((t) => t.id.startsWith("w"))
    .sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)))
    .map((t) => t.id);
const solve = async (ids) => {
  for (const id of ids) await select(id);
  await btn("확인하기").click();
  await page.locator(".feedback").waitFor();
};
const finishOne = async () => {
  await btn("학습 결과 보기").click();
  await page.locator(".result").waitFor();
  await btn("홈으로 돌아가기").click();
  await page
    .getByRole("heading", { name: "오늘도, 한 단어 더.", exact: true })
    .waitFor();
};
const favorites = async () => {
  await nav("학습");
  await page.getByRole("button", { name: /^즐겨찾기 학습/ }).click();
  await page.locator(".assembly-quiz").waitFor();
};
try {
  await mkdir("test-results", { recursive: true });
  await page.goto(base);
  await page
    .getByRole("heading", { name: "오늘도, 한 단어 더.", exact: true })
    .waitFor();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.screenshot({
    path: "test-results/refreshed-home-mobile.png",
    fullPage: true,
  });
  await nav("설정");
  assert.equal(await page.getByLabel("문제 방향", { exact: true }).count(), 0);
  assert.deepEqual(
    await page
      .getByLabel("문제 방식", { exact: true })
      .locator("option")
      .allTextContents(),
    ["단어 → 영어 뜻", "영어 뜻 → 단어", "영어 뜻 문장 조립", "섞어서 풀기"],
  );
  await setting("format", "assembly");
  await setting("autoRead", true);
  await page.screenshot({
    path: "test-results/assembly-settings-mobile.png",
    fullPage: true,
  });
  await nav("학습");
  assert.match(
    await page.locator(".study-method").innerText(),
    /영어 뜻 문장 조립/,
  );
  assert.equal(await page.locator('[data-action="study-format"]').count(), 0);
  await page.getByRole("link", { name: "문제 방식 변경", exact: true }).click();
  await page.getByLabel("문제 방식", { exact: true }).waitFor();
  await setting("format", "mixed");
  await setting("format", "assembly");
  await nav("학습");

  // Two prior unaided dates prepare a promotion without changing today's lesson.
  const borrowId = await page.evaluate(async () => {
    const { read, write } = await import("/src/storage.js");
    const { recordAnswer, dateKey } = await import("/src/core.js");
    const { recordAssembly } = await import("/src/assembly.js");
    const snapshot = await read("snapshot");
    const s = (await read("content")).senses.find((s) => s.word === "borrow");
    snapshot.state.favorites = [s.id];
    for (const offset of [2, 1]) {
      const day = new Date();
      day.setDate(day.getDate() - offset);
      const p = recordAnswer(snapshot.state, s, true, {
        now: day.getTime(),
        kind: "new",
      });
      recordAssembly(p, true, { date: dateKey(day), level: 0 });
    }
    await write("snapshot", snapshot);
    return s.id;
  });
  await page.reload();
  await page
    .getByRole("heading", { name: "어떤 반복을 해볼까요?", exact: true })
    .waitFor();
  await favorites();
  const original = (await saved()).session;
  assert.equal(original.queue.length, 1);
  assert.equal(original.question.level, 0);
  assert.deepEqual(await page.evaluate(() => window.__speechCalls), ["borrow"]);
  assert.equal(await page.locator(".word-card .sentence").count(), 0);
  assert.equal(await page.locator(".feedback").count(), 0);
  assert.equal(
    await page.locator(".assembly-meaning").innerText(),
    original.question.sense.ko,
  );
  assert(await btn("확인하기").isDisabled());
  const ids = canonical(original.question);
  await select(ids[0]);
  assert(
    await page
      .locator(`[data-action="assembly-add"][data-id="${ids[0]}"]`)
      .isDisabled(),
  );
  await page
    .locator(`[data-action="assembly-remove"][data-id="${ids[0]}"]`)
    .click();
  await page.waitForFunction(
    async () =>
      (await (await import("/src/storage.js")).read("snapshot")).session
        .selectedTokens.length === 0,
  );
  await select(ids[1]);
  await btn("처음부터").click();
  await page.waitForFunction(
    async () =>
      (await (await import("/src/storage.js")).read("snapshot")).session
        .selectedTokens.length === 0,
  );
  await select(ids[0]);
  const partial = (await saved()).session;
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true);
  await page.reload();
  await page.locator(".assembly-quiz").waitFor();
  assert.deepEqual((await saved()).session, partial);
  assert.deepEqual(await page.evaluate(() => window.__speechCalls), []);
  await btn("문제 듣기").click();
  assert.deepEqual(await page.evaluate(() => window.__speechCalls), ["borrow"]);
  for (const size of [
    { width: 360, height: 740 },
    { width: 390, height: 844 },
    { width: 320, height: 844 },
    { width: 1440, height: 1000 },
  ]) {
    await page.setViewportSize(size);
    await page.evaluate(() => scrollTo(0, 0));
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      JSON.stringify(size),
    );
    assert(
      await page
        .locator(".word-token")
        .evaluateAll((els) =>
          els.every((e) => e.getBoundingClientRect().height >= 44),
        ),
    );
    if (size.width === 360 || size.width === 390) {
      assert(
        await page
          .locator('[data-action="assembly-submit"]')
          .evaluate(
            (e) =>
              e.getBoundingClientRect().bottom <=
              document.querySelector("#navigation").getBoundingClientRect().top,
          ),
        "Typical assembly fits above navigation",
      );
    }
    if (size.width === 390)
      await page.screenshot({
        path: "test-results/assembly-mobile.png",
        fullPage: true,
      });
    if (size.width === 1440)
      await page.screenshot({
        path: "test-results/assembly-desktop.png",
        fullPage: true,
      });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await solve(ids.slice(1));
  let result = await saved();
  assert.equal(result.session.lastCorrect, true);
  assert.equal(result.state.progress[borrowId].assembly.level, 1);
  assert.equal(result.session.question.level, 0);
  assert.equal(result.session.attempts, 1);
  await btn("정답·예문 듣기").click();
  assert(
    (await page.evaluate(() => window.__speechCalls)).includes(
      original.question.sense.definitions[original.question.definitionIndex],
    ),
  );
  await context.setOffline(false);
  await finishOne();

  // A wrong word order is graded once; a second challenge error lowers future difficulty.
  await favorites();
  const challenge = (await saved()).session.question;
  assert.equal(challenge.level, 1);
  const wrong = canonical(challenge);
  [wrong[0], wrong[1]] = [wrong[1], wrong[0]];
  await solve(wrong);
  result = await saved();
  assert.equal(result.session.lastCorrect, false);
  assert.equal(result.state.progress[borrowId].assembly.wrongStreak, 1);
  await page.reload();
  await page.locator(".feedback.wrong").waitFor();
  assert.equal((await saved()).session.attempts, 1);
  assert.equal(
    await page.locator(".assembled-sentence button").count(),
    wrong.length,
  );
  await finishOne();
  await favorites();
  assert.equal((await saved()).session.question.level, 1);
  await btn("모르겠어요").evaluate((button) => {
    button.click();
    button.click();
  });
  await page.locator(".feedback.wrong").waitFor();
  assert.equal((await saved()).session.attempts, 1);
  assert.equal((await saved()).state.progress[borrowId].assembly.level, 0);
  await finishOne();

  // A first attempt with a persisted hint receives credit but no mastery day.
  await page.evaluate(async () => {
    const { read, write } = await import("/src/storage.js");
    const snapshot = await read("snapshot");
    const s = {
      id: "custom-duplicate",
      word: "borrow",
      ko: "빌리다",
      pos: "verb",
      level: "beginner",
      definitions: ["to use a pen and a book"],
      examples: ["Can I {} a pen?", "May I {} a book?"],
      distractors: [],
    };
    snapshot.state.custom.push(s);
    snapshot.state.favorites = [s.id];
    await write("snapshot", snapshot);
  });
  await page.reload();
  await page
    .getByRole("heading", { name: "오늘도, 한 단어 더.", exact: true })
    .waitFor();
  await favorites();
  await btn("첫 단어 힌트").click();
  await page.locator(".word-token.hinted").first().waitFor();
  await select("w0");
  await page.reload();
  await page.locator(".assembly-quiz").waitFor();
  assert.equal((await saved()).session.assemblyAssisted, true);
  await btn("처음부터").click();
  await page.waitForFunction(
    async () =>
      (await (await import("/src/storage.js")).read("snapshot")).session
        .selectedTokens.length === 0,
  );
  // Interchange the two independent 'a' pieces.
  await solve(["w0", "w1", "w5", "w3", "w4", "w2", "w6"]);
  result = await saved();
  assert.equal(result.session.lastCorrect, true);
  assert.deepEqual(
    result.state.progress["custom-duplicate"].assembly.qualifiedDates,
    [],
  );
  await finishOne();

  // Turning off adaptation starts new questions at zero without discarding mastery.
  await nav("설정");
  await setting("adaptiveAssembly", false);
  await page.evaluate(async (id) => {
    const { read, write } = await import("/src/storage.js");
    const snapshot = await read("snapshot");
    snapshot.state.progress[id].assembly.level = 2;
    snapshot.state.favorites = [id];
    await write("snapshot", snapshot);
  }, borrowId);
  await page.reload();
  await page.getByLabel("방해 단어 자동 조절", { exact: true }).waitFor();
  await favorites();
  assert.equal((await saved()).session.question.level, 0);
  await solve(canonical((await saved()).session.question));
  assert.equal((await saved()).state.progress[borrowId].assembly.level, 2);
  await finishOne();

  // A 10-question mixed session includes exactly seven choices and three assemblies.
  await nav("설정");
  await setting("format", "mixed");
  await nav("학습");
  await page.getByRole("button", { name: /^새 단어 배우기/ }).click();
  await page.locator(".quiz").waitFor();
  const queue = (await saved()).session.queue;
  assert.equal(queue.length, 10);
  assert.equal(queue.filter((q) => q.format === "assembly").length, 3);
  await nav("설정");
  await setting("format", "word");
  await nav("학습");
  await page.getByRole("link", { name: "이어서 풀기" }).click();
  await page.locator(".quiz").waitFor();
  assert.deepEqual((await saved()).session.queue, queue);
  for (let i = 0; i < 10; i++) {
    await page.waitForFunction(
      (index) =>
        document.querySelector(".quiz-count strong")?.textContent ===
        String(index + 1),
      i,
    );
    assert.equal((await saved()).session.queue.length, 10);
    const question = (await saved()).session.question;
    assert.equal(
      question.type === "assembly" ? "assembly" : "choice",
      queue[i].format,
    );
    if (queue[i].format === "choice")
      assert.equal(question.direction, queue[i].direction);
    await btn("모르겠어요").click();
    await page.locator(".feedback.wrong").waitFor();
    await btn(i === 9 ? "학습 결과 보기" : "다음 문제").click();
  }
  await page.locator(".result").waitFor();
  result = await saved();
  assert.equal(result.session.complete, true);
  assert.equal(result.session.attempts, 10);
  assert.equal(result.session.queue.length, 10);
  assert.equal(result.session.index, 10);

  // Reproduce a 1.5.0 lesson whose choice directions were stored in settings.
  // Updating settings after migration must affect only a newly started lesson.
  const legacyContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  try {
    const legacyPage = await legacyContext.newPage();
    legacyPage.on("pageerror", (e) => errors.push(e.message));
    const legacySaved = () =>
      legacyPage.evaluate(async () =>
        (await import("/src/storage.js")).read("snapshot"),
      );
    const legacyNav = async (name) => {
      await legacyPage.getByRole("link", { name, exact: true }).click();
      await legacyPage.waitForFunction(
        (label) =>
          document.querySelector(".nav-item.active")?.textContent.trim() ===
          label,
        name,
      );
    };
    await legacyPage.goto(base);
    await legacyPage
      .getByRole("heading", { name: "오늘도, 한 단어 더.", exact: true })
      .waitFor();
    await legacyNav("설정");
    await legacyPage
      .getByLabel("문제 방식", { exact: true })
      .selectOption("word");
    await legacyPage.waitForFunction(
      async () =>
        (await (await import("/src/storage.js")).read("snapshot")).state
          .settings.format === "word",
    );
    await legacyNav("학습");
    await legacyPage.getByRole("button", { name: /^새 단어 배우기/ }).click();
    await legacyPage.locator(".quiz").waitFor();
    await legacyPage
      .getByRole("button", { name: "모르겠어요", exact: true })
      .click();
    await legacyPage
      .getByRole("button", { name: "다음 문제", exact: true })
      .click();
    await legacyPage.waitForFunction(
      () => document.querySelector(".quiz-count strong")?.textContent === "2",
    );
    const beforeLegacy = await legacyPage.evaluate(async () => {
      const { read, write } = await import("/src/storage.js");
      const s = await read("snapshot");
      s.state.settings.format = "choice";
      s.state.settings.mode = "word";
      s.session.format = "choice";
      s.session.queue.forEach((item) => delete item.direction);
      await write("snapshot", s);
      return s;
    });
    await legacyPage.reload();
    await legacyPage.locator(".quiz").waitFor();
    let migrated = await legacySaved();
    assert.equal(migrated.state.settings.format, "word");
    assert.equal(Object.hasOwn(migrated.state.settings, "mode"), false);
    assert.equal(migrated.session.choiceMode, "word");
    const unchanged = structuredClone(migrated.session);
    delete unchanged.choiceMode;
    assert.deepEqual(unchanged, beforeLegacy.session);
    assert.deepEqual(migrated.state.progress, beforeLegacy.state.progress);
    assert.deepEqual(migrated.state.days, beforeLegacy.state.days);
    await legacyNav("설정");
    await legacyPage
      .getByLabel("문제 방식", { exact: true })
      .selectOption("assembly");
    await legacyPage.waitForFunction(
      async () =>
        (await (await import("/src/storage.js")).read("snapshot")).state
          .settings.format === "assembly",
    );
    await legacyPage.reload();
    await legacyPage.getByLabel("문제 방식", { exact: true }).waitFor();
    await legacyNav("학습");
    await legacyPage.getByRole("link", { name: "이어서 풀기" }).click();
    await legacyPage.locator(".quiz").waitFor();
    assert.deepEqual(
      (await legacySaved()).session.question,
      beforeLegacy.session.question,
    );
    await legacyPage
      .getByRole("button", { name: "모르겠어요", exact: true })
      .click();
    await legacyPage
      .getByRole("button", { name: "다음 문제", exact: true })
      .click();
    await legacyPage.waitForFunction(
      () => document.querySelector(".quiz-count strong")?.textContent === "3",
    );
    migrated = await legacySaved();
    assert.equal(migrated.session.question.direction, "word");
    assert.equal(migrated.session.queue.length, 10);
    assert.equal(await legacyPage.locator(".answer").count(), 4);
    await legacyPage
      .getByRole("button", { name: "학습 잠시 멈추기", exact: true })
      .click();
    await legacyPage
      .getByRole("heading", { name: "어떤 반복을 해볼까요?", exact: true })
      .waitFor();
    for (const width of [320, 390, 1440]) {
      await legacyPage.setViewportSize({ width, height: 844 });
      assert(
        await legacyPage.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      await legacyPage.screenshot({
        path: `test-results/unified-method-menu-${width}.png`,
        fullPage: true,
      });
    }
    legacyPage.once("dialog", (dialog) => dialog.accept());
    await legacyPage.getByRole("button", { name: /^새 단어 배우기/ }).click();
    await legacyPage.locator(".assembly-quiz").waitFor();
    assert(
      (await legacySaved()).session.queue.every(
        (item) => item.format === "assembly",
      ),
    );
  } finally {
    await legacyContext.close();
  }
  assert.deepEqual(errors, []);
  console.log(
    "Assembly browser checks passed: fixed mixed session, selection/resume/offline, speech, mastery, hint, mobile and desktop layouts.",
  );
} finally {
  await context.close();
  await browser.close();
  server.kill();
}
