// Optional browser integration suite. The shipped application has no npm dependencies.
// npm install --no-save playwright && npx playwright install chromium
// node tests/browser-smoke.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const temp = await mkdtemp(path.join(os.tmpdir(), "wordloop-test-"));
await cp("dist", temp, { recursive: true });
await mkdir("test-results", { recursive: true });
const server = spawn(process.execPath, ["scripts/serve.mjs"], {
  env: { ...process.env, PORT: "4390", SERVE_DIR: temp },
});
await new Promise((res, rej) => {
  server.stdout.once("data", res);
  server.once("error", rej);
  server.once("exit", () => rej(Error("Test server stopped")));
});
const browser = await chromium.launch({
  headless: true,
  ...(process.env.WORDLOOP_CHROMIUM_PATH
    ? { executablePath: process.env.WORDLOOP_CHROMIUM_PATH }
    : {}),
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
});
const base = "http://127.0.0.1:4390/";
let contexts = [];
const errors = [];
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  timezoneId: "Asia/Seoul",
});
contexts.push(context);
const page = await context.newPage();
page.on("pageerror", (e) => errors.push(e.message));
const visible = (p, role, name) =>
  p.getByRole(role, { name, exact: true }).waitFor({ state: "visible" });
try {
  await page.goto(base);
  await visible(page, "heading", "오늘도, 한 단어 더.");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.screenshot({
    path: "test-results/home-mobile.png",
    fullPage: true,
  });
  // Reproduce an existing user's 1,062-word catalog and unfinished lesson.
  // A content upgrade must preserve the current question, answers and queue.
  const upgradeContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    timezoneId: "Asia/Seoul",
  });
  contexts.push(upgradeContext);
  const upgradePage = await upgradeContext.newPage();
  upgradePage.on("pageerror", (e) => errors.push(e.message));
  await upgradePage.goto(base);
  await upgradePage.getByRole("button", { name: "오늘 학습 시작하기" }).click();
  await visible(upgradePage, "button", "모르겠어요");
  // Upgrade a saved pre-question learning card without changing its question,
  // queue or learning history. It must become answerable immediately.
  const beforeFlowUpgrade = await upgradePage.evaluate(async () => {
    const { read, write } = await import("/src/storage.js");
    const snapshot = await read("snapshot");
    const before = structuredClone(snapshot);
    snapshot.session.phase = "learn";
    snapshot.session.showHint = true;
    await write("snapshot", snapshot);
    return before;
  });
  await upgradePage.reload();
  await visible(upgradePage, "button", "모르겠어요");
  assert.equal(
    await upgradePage
      .getByRole("button", { name: "이제 문제로 확인하기" })
      .count(),
    0,
  );
  assert.equal(await upgradePage.locator(".answer").count(), 4);
  const afterFlowUpgrade = await upgradePage.evaluate(async () =>
    (await import("/src/storage.js")).read("snapshot"),
  );
  assert.deepEqual(afterFlowUpgrade, beforeFlowUpgrade);
  const upgradeId = await upgradePage
    .locator(".quiz-labels .favorite")
    .getAttribute("data-id");
  await upgradePage
    .locator(`.answer:not([data-id="${upgradeId}"])`)
    .first()
    .click();
  await visible(upgradePage, "button", "다음 문제");
  const beforeUpgrade = await upgradePage.evaluate(async () => {
    const { read, write } = await import("/src/storage.js");
    const content = await read("content");
    content.senses = content.senses.filter(
      (s) => !s.id.endsWith("-exp-202609"),
    );
    content.version = "legacy-1200";
    if (new Set(content.senses.map((s) => s.word)).size !== 1062)
      throw Error("Invalid legacy catalog fixture");
    await write("content", content);
    return read("snapshot");
  });
  await upgradePage.getByRole("link", { name: "홈", exact: true }).click();
  await upgradePage.reload();
  await upgradePage.waitForFunction(async () => {
    const content = await (await import("/src/storage.js")).read("content");
    return content.senses.length === 4200;
  });
  await upgradePage
    .locator(".vocab-total")
    .getByText("4,062", { exact: true })
    .waitFor();
  const afterUpgrade = await upgradePage.evaluate(async () =>
    (await import("/src/storage.js")).read("snapshot"),
  );
  assert.deepEqual(afterUpgrade.session, beforeUpgrade.session);
  assert.deepEqual(afterUpgrade.state, beforeUpgrade.state);
  // The learning tab always opens the menu, even with an unfinished lesson.
  await upgradePage.getByRole("link", { name: "학습", exact: true }).click();
  await visible(upgradePage, "heading", "어떤 반복을 해볼까요?");
  assert.equal(await upgradePage.locator(".mode-card").count(), 4);
  await upgradePage.getByRole("button", { name: /^오늘의 복습/ }).click();
  await upgradePage
    .getByText("지금 복습할 문제가 없어요.", { exact: true })
    .waitFor();
  await upgradePage.getByRole("link", { name: "이어서 풀기" }).click();
  await visible(upgradePage, "button", "다음 문제");
  assert.equal(await upgradePage.locator(".answer.wrong").count(), 1);
  assert.match(
    await upgradePage.locator(".quiz-count").innerText(),
    /1 \/ 10$/,
  );
  await upgradePage.getByRole("button", { name: "학습 잠시 멈추기" }).click();
  await visible(upgradePage, "heading", "어떤 반복을 해볼까요?");
  upgradePage.once("dialog", (dialog) => dialog.accept());
  await upgradePage.getByRole("button", { name: /^틀린 문제만/ }).click();
  await upgradePage.locator(".quiz").waitFor();
  assert.match(await upgradePage.locator(".quiz-count").innerText(), /1 \/ 1$/);
  assert.equal(
    await upgradePage.locator(".quiz-labels .favorite").getAttribute("data-id"),
    upgradeId,
  );
  await upgradePage
    .getByRole("button", { name: "모르겠어요", exact: true })
    .click();
  await visible(upgradePage, "button", "학습 결과 보기");
  await upgradePage.getByRole("button", { name: "학습 결과 보기" }).click();
  await upgradePage.getByRole("button", { name: "홈으로 돌아가기" }).click();
  // 'I don't know' must respect the existing mistake-notebook preference.
  await upgradePage.getByRole("link", { name: "설정", exact: true }).click();
  await upgradePage.getByLabel("오답 자동 저장", { exact: true }).uncheck();
  await upgradePage.getByText("설정을 저장했어요.", { exact: true }).waitFor();
  await upgradePage.getByRole("link", { name: "학습", exact: true }).click();
  await upgradePage.getByRole("button", { name: /^새 단어 배우기/ }).click();
  await visible(upgradePage, "button", "모르겠어요");
  const withoutNotebookId = await upgradePage
    .locator(".quiz-labels .favorite")
    .getAttribute("data-id");
  assert.notEqual(withoutNotebookId, upgradeId);
  await upgradePage
    .getByRole("button", { name: "모르겠어요", exact: true })
    .click();
  await upgradePage
    .getByText("오답 자동 저장은 꺼져 있어요. 일반 복습에는 반영했어요.", {
      exact: true,
    })
    .waitFor();
  const withoutNotebook = await upgradePage.evaluate(
    async (id) =>
      (await (await import("/src/storage.js")).read("snapshot")).state.progress[
        id
      ],
    withoutNotebookId,
  );
  assert.equal(withoutNotebook.mistake, null);
  assert.equal(withoutNotebook.wrong, 1);
  assert(withoutNotebook.due > Date.now());
  await upgradeContext.close();
  // A retired visibility preference must not block learning or survive a reload.
  const seedRemovedSetting = () =>
    page.evaluate(async () => {
      const { read, write } = await import("/src/storage.js");
      const snapshot = await read("snapshot");
      snapshot.state.settings.hideEnglish = true;
      await write("snapshot", snapshot);
    });
  await page.getByRole("link", { name: "설정", exact: true }).click();
  await page.getByText("4,062단어 · 4,200개의 뜻", { exact: true }).waitFor();
  for (const name of ["하루 새 단어 수", "하루 복습 문제 수"]) {
    const input = page.getByLabel(name, { exact: true });
    assert.equal(await input.getAttribute("max"), "300");
    await input.fill("300");
    await input.press("Tab");
    await page.getByText("설정을 저장했어요.", { exact: true }).waitFor();
  }
  await seedRemovedSetting();
  await page.reload();
  await visible(page, "heading", "나에게 맞는 학습");
  assert.equal(
    await page.getByLabel("영어 숨기기", { exact: true }).count(),
    0,
  );
  assert.equal(
    await page.getByLabel("하루 새 단어 수", { exact: true }).inputValue(),
    "300",
  );
  assert.equal(
    await page.getByLabel("하루 복습 문제 수", { exact: true }).inputValue(),
    "300",
  );
  const retiredSettingExists = await page.evaluate(async () => {
    const snapshot = await (await import("/src/storage.js")).read("snapshot");
    return Object.hasOwn(snapshot.state.settings, "hideEnglish");
  });
  assert.equal(retiredSettingExists, false);
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    const height = await page
      .locator("#navigation")
      .evaluate((el) => el.getBoundingClientRect().height);
    assert(height >= 58 && height <= 60, `Mobile navigation height: ${height}`);
  }
  await page.getByRole("link", { name: "단어장", exact: true }).click();
  await page.locator(".word-open").first().click();
  assert.match(await page.locator("dialog .word").innerText(), /[A-Za-z]/);
  await page.getByRole("button", { name: "닫기", exact: true }).click();
  await page.getByRole("link", { name: "학습", exact: true }).click();
  await visible(page, "heading", "어떤 반복을 해볼까요?");
  assert.equal(await page.locator(".mode-card").count(), 4);
  await page.getByRole("link", { name: "설정", exact: true }).click();
  await page.getByLabel("하루 새 단어 수", { exact: true }).fill("1");
  await page.getByLabel("하루 새 단어 수", { exact: true }).press("Tab");
  await page.getByText("설정을 저장했어요.", { exact: true }).waitFor();
  await page.getByLabel("문제 방향", { exact: true }).selectOption("meaning");
  await page.getByText("설정을 저장했어요.", { exact: true }).waitFor();
  await page.getByRole("link", { name: "홈", exact: true }).click();
  await page.getByRole("button", { name: "오늘 학습 시작하기" }).click();
  await visible(page, "button", "모르겠어요");
  assert.equal(await page.locator(".answer").count(), 4);
  assert.equal(await page.locator(".word-card .definition-prompt").count(), 0);
  assert.equal(await page.locator(".feedback").count(), 0);
  const id = await page
    .locator(".quiz-labels .favorite")
    .getAttribute("data-id");
  await page.locator(`.answer:not([data-id="${id}"])`).first().click();
  await visible(page, "button", "학습 결과 보기");
  await seedRemovedSetting();
  await page.reload();
  await visible(page, "button", "학습 결과 보기");
  assert.equal(await page.locator(".answer.wrong").count(), 1);
  await page.screenshot({
    path: "test-results/quiz-mobile.png",
    fullPage: true,
  });
  assert.match(await page.locator(".quiz-count").innerText(), /1 \/ 1$/);
  await page.getByRole("button", { name: "학습 결과 보기" }).click();
  await visible(page, "heading", "오늘의 반복이 쌓였어요.");
  await page.getByRole("button", { name: "헷갈린 1개 다시 풀기" }).click();
  assert.match(await page.locator(".quiz-count").innerText(), /1 \/ 1$/);
  await page.locator(`.answer[data-id="${id}"]`).click();
  await page.locator(".feedback:not(.wrong)").waitFor();
  assert.match(await page.locator(".feedback-meaning").innerText(), /[가-힣]/);
  assert.equal(await page.locator(".feedback .sentence mark").count(), 1);
  await page.getByRole("button", { name: "학습 결과 보기" }).click();
  await page.getByRole("button", { name: "홈으로 돌아가기" }).click();
  await page.getByRole("link", { name: "단어장", exact: true }).click();
  await page.getByRole("button", { name: "틀린 문제", exact: true }).click();
  assert.equal(await page.locator(".word-row").count(), 1);
  await page.locator(".check-word").check();
  assert.equal(
    await page.getByRole("button", { name: "선택한 1개 풀기" }).isEnabled(),
    true,
  );
  await page.getByRole("button", { name: "전체", exact: true }).click();
  await page.getByRole("searchbox").fill("book");
  assert((await page.locator(".word-row").count()) >= 3);
  await page.getByRole("button", { name: "추가", exact: true }).click();
  await page.getByLabel("영어 단어", { exact: true }).fill("persist");
  await page
    .getByLabel("쉬운 영어 뜻", { exact: true })
    .fill("to keep trying even when something is difficult");
  await page
    .getByLabel("예문", { exact: true })
    .fill("I will persist until I finish.");
  await page.getByLabel("한국어 힌트", { exact: true }).fill("꾸준히 계속하다");
  await page.getByRole("button", { name: "저장하기", exact: true }).click();
  await page.getByText("내 단어장에 저장했어요.", { exact: true }).waitFor();
  await page.getByRole("searchbox").fill("persist");
  const customWordRow = page.locator(".word-row").filter({
    has: page.locator(".word-open strong").filter({ hasText: /^persist$/ }),
  });
  assert.equal(await customWordRow.count(), 1);
  await page
    .getByRole("button", { name: "persist 즐겨찾기", exact: true })
    .click();
  await page
    .locator('[aria-label="persist 즐겨찾기"][aria-pressed=true]')
    .waitFor();
  await customWordRow.locator(".word-open").click();
  await page.getByRole("button", { name: "이 뜻 학습하기" }).click();
  await visible(page, "button", "모르겠어요");
  await page.getByRole("button", { name: "정답 보기", exact: true }).click();
  await visible(page, "button", "알고 있어요");
  assert.equal(
    await page.getByRole("button", { name: "모르겠어요", exact: true }).count(),
    0,
  );
  await page.getByRole("button", { name: "알고 있어요", exact: true }).click();
  await page.getByRole("button", { name: "학습 결과 보기" }).click();
  await page.getByRole("button", { name: "홈으로 돌아가기" }).click();
  await page.getByRole("link", { name: "설정", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "백업 저장" }).click();
  const download = await downloadPromise;
  const backup = JSON.parse(await readFile(await download.path(), "utf8"));
  assert.equal(backup.state.custom.length, 1);
  assert(backup.state.favorites.includes(backup.state.custom[0].id));
  assert.equal(
    backup.state.days["2026-09-25"]?.newWords.length ??
      Object.values(backup.state.days)[0].newWords.length,
    2,
  );
  const backupPath = path.join(temp, "backup.json");
  await writeFile(backupPath, JSON.stringify(backup));
  // Verify content updates preserve the full learning state, then reject a mixed deployment.
  const dataPath = path.join(temp, "data/beginner.json");
  const pack = JSON.parse(await readFile(dataPath, "utf8"));
  const borrowed = pack.senses.find((s) => s.id === id);
  borrowed.definitions[0] = "to use another person’s thing and return it later";
  await writeFile(dataPath, JSON.stringify(pack));
  const manifestPath = path.join(temp, "data/manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.version = "test-content-update";
  const file = manifest.files.find((f) => f.path === "data/beginner.json");
  file.sha256 = createHash("sha256")
    .update(await readFile(dataPath))
    .digest("hex");
  await writeFile(manifestPath, JSON.stringify(manifest));
  await page
    .getByRole("button", { name: "업데이트 확인", exact: true })
    .click();
  await page
    .getByText("단어장을 업데이트했어요. 학습 기록은 그대로예요.", {
      exact: true,
    })
    .waitFor();
  await page.getByRole("link", { name: "단어장", exact: true }).click();
  await page.getByRole("searchbox").fill("borrow");
  assert(
    (await page.locator(".word-open").first().innerText()).includes(
      "return it later",
    ),
  );
  await page.getByRole("link", { name: "설정", exact: true }).click();
  manifest.version = "test-broken-update";
  file.sha256 = "0".repeat(64);
  await writeFile(manifestPath, JSON.stringify(manifest));
  await page
    .getByRole("button", { name: "업데이트 확인", exact: true })
    .click();
  await page
    .getByText(
      "업데이트를 확인하지 못했어요. 저장된 단어장으로 계속 학습할 수 있어요.",
      { exact: true },
    )
    .waitFor();
  await context.setOffline(true);
  await page.reload();
  await visible(page, "heading", "나에게 맞는 학습");
  assert.equal(
    await page.getByLabel("하루 새 단어 수", { exact: true }).inputValue(),
    "1",
  );
  await page.getByRole("link", { name: "단어장", exact: true }).click();
  await page.getByRole("searchbox").fill("persist");
  assert.equal(await customWordRow.count(), 1);
  await context.setOffline(false);
  // A fresh browser context simulates restoring onto a new device.
  const restored = await browser.newContext({
    viewport: { width: 320, height: 720 },
    timezoneId: "Asia/Seoul",
  });
  contexts.push(restored);
  const other = await restored.newPage();
  other.on("pageerror", (e) => errors.push(e.message));
  manifest.version = "test-content-update";
  file.sha256 = createHash("sha256")
    .update(await readFile(dataPath))
    .digest("hex");
  await writeFile(manifestPath, JSON.stringify(manifest));
  await other.goto(base);
  await visible(other, "heading", "오늘도, 한 단어 더.");
  await other.getByRole("link", { name: "설정", exact: true }).click();
  other.on("dialog", (d) => d.accept());
  await other.locator("#backup-file").setInputFiles(backupPath);
  await other.getByText("백업을 불러왔어요.", { exact: true }).waitFor();
  assert.equal(
    await other.getByLabel("하루 새 단어 수", { exact: true }).inputValue(),
    "1",
  );
  for (const [route, label, title] of [
    ["home", "홈", "오늘도, 한 단어 더."],
    ["learn", "학습", "어떤 반복을 해볼까요?"],
    ["words", "단어장", "나의 단어장"],
    ["settings", "설정", "나에게 맞는 학습"],
  ]) {
    await other.getByRole("link", { name: label, exact: true }).click();
    await visible(other, "heading", title);
    assert(
      await other.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      `320px overflow in ${route}`,
    );
    await other.screenshot({
      path: `test-results/${route}-320.png`,
      fullPage: true,
    });
  }
  const secondTab = await restored.newPage();
  await secondTab.goto(base);
  await visible(secondTab, "heading", "다른 창에서 워드루프를 사용 중이에요.");
  await secondTab.close();
  await page.getByRole("link", { name: "홈", exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: "test-results/home-desktop.png",
    fullPage: true,
  });
  // Wrong answers and 'I don't know' never extend a ten-question lesson.
  const fixedContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  contexts.push(fixedContext);
  const fixedPage = await fixedContext.newPage();
  fixedPage.on("pageerror", (e) => errors.push(e.message));
  await fixedPage.goto(base);
  await fixedPage.getByRole("link", { name: "설정", exact: true }).click();
  await fixedPage.getByLabel("문제 방향", { exact: true }).selectOption("word");
  await fixedPage.getByText("설정을 저장했어요.", { exact: true }).waitFor();
  await fixedPage.getByRole("link", { name: "홈", exact: true }).click();
  await fixedPage.getByRole("button", { name: "오늘 학습 시작하기" }).click();
  const originalIds = [];
  for (let i = 1; i <= 10; i++) {
    await fixedPage.waitForFunction(
      (expected) =>
        document.querySelector(".quiz-count strong")?.textContent ===
        String(expected),
      i,
    );
    await visible(fixedPage, "button", "모르겠어요");
    assert.equal(await fixedPage.locator(".answer").count(), 4);
    assert.equal(await fixedPage.locator(".word-card .word").count(), 0);
    assert.equal(await fixedPage.locator(".word-card .blank").count(), 1);
    assert.equal(await fixedPage.locator(".feedback").count(), 0);
    const currentId = await fixedPage
      .locator(".quiz-labels .favorite")
      .getAttribute("data-id");
    originalIds.push(currentId);
    if (i === 1) {
      await fixedPage.screenshot({
        path: "test-results/question-first-mobile.png",
        fullPage: true,
      });
      // A quick double tap must still record just one wrong answer.
      await fixedPage
        .getByRole("button", { name: "모르겠어요", exact: true })
        .evaluate((el) => {
          el.click();
          el.click();
        });
    } else if (i % 2 === 1) {
      await fixedPage
        .getByRole("button", { name: "모르겠어요", exact: true })
        .click();
    } else {
      await fixedPage
        .locator(`.answer:not([data-id="${currentId}"])`)
        .first()
        .click();
    }
    await visible(
      fixedPage,
      "button",
      i === 10 ? "학습 결과 보기" : "다음 문제",
    );
    assert.match(
      await fixedPage.locator(".quiz-count").innerText(),
      new RegExp(`${i} / 10$`),
    );
    if (i === 1) {
      assert.equal(await fixedPage.locator(".answer.correct").count(), 1);
      assert.equal(await fixedPage.locator(".answer.wrong").count(), 0);
      // The explanation and next button must clear the fixed mobile navigation.
      await fixedPage.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
      assert(
        await fixedPage.evaluate(() => {
          const feedback = document
            .querySelector(".feedback")
            .getBoundingClientRect();
          const next = document
            .querySelector('[data-action="next"]')
            .getBoundingClientRect();
          const nav = document
            .querySelector("#navigation")
            .getBoundingClientRect();
          return feedback.top >= 0 && next.bottom <= nav.top;
        }),
      );
      await fixedPage.screenshot({
        path: "test-results/answer-viewport-mobile.png",
      });
      await fixedPage.reload();
      await visible(fixedPage, "button", "다음 문제");
      const skipped = await fixedPage.evaluate(async () =>
        (await import("/src/storage.js")).read("snapshot"),
      );
      assert.equal(skipped.session.choice, null);
      assert.equal(skipped.session.attempts, 1);
      assert.equal(skipped.session.queue.length, 10);
      assert.equal(skipped.state.progress[currentId].seen, 1);
      assert.equal(skipped.state.progress[currentId].wrong, 1);
      assert.equal(skipped.state.progress[currentId].mistake, "active");
      assert.equal(
        await fixedPage.locator(".feedback .sentence mark").innerText(),
        skipped.session.question.sense.word,
      );
      await fixedPage.screenshot({
        path: "test-results/answer-explanation-mobile.png",
        fullPage: true,
      });
    }
    if (i === 4) {
      // Simulate the queued retries left behind by the previous app version.
      await fixedPage.evaluate(async () => {
        const { read, write } = await import("/src/storage.js");
        const snapshot = await read("snapshot");
        snapshot.session.queue.push({
          id: snapshot.session.queue[0].id,
          kind: "review",
          retry: true,
        });
        await write("snapshot", snapshot);
      });
      await fixedPage.reload();
      await visible(fixedPage, "button", "다음 문제");
      assert.match(
        await fixedPage.locator(".quiz-count").innerText(),
        /4 \/ 10$/,
      );
      assert.equal(await fixedPage.locator(".answer.wrong").count(), 1);
    }
    await fixedPage
      .getByRole("button", {
        name: i === 10 ? "학습 결과 보기" : "다음 문제",
        exact: true,
      })
      .click();
  }
  await visible(fixedPage, "heading", "오늘의 반복이 쌓였어요.");
  assert.equal(new Set(originalIds).size, 10);
  assert.deepEqual(
    await fixedPage.locator(".result-stats strong").allTextContents(),
    ["10", "10", "0%"],
  );
  await fixedPage
    .getByRole("button", { name: "헷갈린 10개 다시 풀기" })
    .click();
  for (let i = 1; i <= 10; i++) {
    await fixedPage.waitForFunction(
      (expected) =>
        document.querySelector(".quiz-count strong")?.textContent ===
        String(expected),
      i,
    );
    const currentId = await fixedPage
      .locator(".quiz-labels .favorite")
      .getAttribute("data-id");
    assert(originalIds.includes(currentId));
    await fixedPage
      .locator(`.answer:not([data-id="${currentId}"])`)
      .first()
      .click();
    await visible(
      fixedPage,
      "button",
      i === 10 ? "학습 결과 보기" : "다음 문제",
    );
    assert.match(
      await fixedPage.locator(".quiz-count").innerText(),
      new RegExp(`${i} / 10$`),
    );
    await fixedPage
      .getByRole("button", {
        name: i === 10 ? "학습 결과 보기" : "다음 문제",
        exact: true,
      })
      .click();
  }
  await visible(fixedPage, "heading", "오늘의 반복이 쌓였어요.");
  assert.deepEqual(
    await fixedPage.locator(".result-stats strong").allTextContents(),
    ["10", "10", "0%"],
  );
  const fixedSnapshot = await fixedPage.evaluate(async () =>
    (await import("/src/storage.js")).read("snapshot"),
  );
  assert.equal(Object.keys(fixedSnapshot.state.progress).length, 10);
  assert(
    Object.values(fixedSnapshot.state.progress).every(
      (p) => p.mistake === "active",
    ),
  );
  assert.equal(Object.values(fixedSnapshot.state.days)[0].newWords.length, 10);
  await fixedPage.getByRole("link", { name: "학습", exact: true }).click();
  await visible(fixedPage, "heading", "어떤 반복을 해볼까요?");
  assert.equal(await fixedPage.locator(".mode-card").count(), 4);
  await fixedPage.getByRole("button", { name: /^틀린 문제만/ }).click();
  await fixedPage.locator(".quiz").waitFor();
  const beforeAppUpdate = await fixedPage.evaluate(async () =>
    (await import("/src/storage.js")).read("snapshot"),
  );
  // An installed PWA can explicitly activate its waiting worker and reload
  // without clearing IndexedDB or replacing an unfinished learning session.
  const swPath = path.join(temp, "sw.js");
  await writeFile(
    swPath,
    (await readFile(swPath, "utf8")).replace(
      /wordloop-([a-f0-9]+)/,
      "wordloop-$1-update-test",
    ),
  );
  await fixedPage.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    await registration.update();
  });
  await visible(fixedPage, "button", "지금 적용");
  await Promise.all([
    fixedPage.waitForNavigation({ waitUntil: "domcontentloaded" }),
    fixedPage.getByRole("button", { name: "지금 적용", exact: true }).click(),
  ]);
  await fixedPage.locator(".quiz").waitFor();
  const afterAppUpdate = await fixedPage.evaluate(async () =>
    (await import("/src/storage.js")).read("snapshot"),
  );
  assert.deepEqual(afterAppUpdate, beforeAppUpdate);
  assert.equal(await fixedPage.locator("#app-update").count(), 0);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: question-first flow in both directions, saved learning-card migration, unknown answers with/without mistake notebook and duplicate taps, post-answer meanings/examples, legacy 1,062-word catalog upgrades during unfinished lessons, learning menu/review/mistake access, installed app update preserves session, 300-item goals, removal of English hiding including saved preferences, compact navigation, fixed-length lesson/manual retry, reload, mistakes, selection, custom recall, favorites, backup restore, content update, bad-update fallback, offline, multi-tab protection, 320/390/1440px layouts.",
  );
} finally {
  await Promise.all(contexts.map((c) => c.close()));
  await browser.close();
  server.kill();
  await rm(temp, { recursive: true, force: true });
}
