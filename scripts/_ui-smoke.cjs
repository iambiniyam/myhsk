const { chromium } = require("playwright-core");

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

  const report = {};

  // 1. Landing page
  await page.goto("http://localhost:8788/", { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  report.landingTitle = await page.title();
  report.landingH1 = await page.locator("h1").first().textContent().catch(() => "");
  report.landingButtons = await page.locator("button").allTextContents();
  report.landingHasStart = report.landingButtons.some((t) => /start|begin/i.test(t));
  await page.screenshot({ path: "/tmp/check-landing-mobile.png" });

  // 2. Enter the learning app
  const start = page.locator("button", { hasText: /start learning|begin/i }).first();
  if (await start.count()) {
    await start.click();
    await page.waitForTimeout(2500);
    report.learnPath = page.url();
    report.learnH1 = await page.locator("h1").first().textContent().catch(() => "");
    report.wordLibraryVisible = await page.locator("text=Word library").count();
    report.groupButtons = await page.locator("button", { hasText: /Learn a group|study/i }).count();
    await page.screenshot({ path: "/tmp/check-learn-mobile.png" });

    // 3. Try to open a learning group
    const groupBtn = page.locator("button", { hasText: /Learn a group/ }).first();
    if (await groupBtn.count()) {
      await groupBtn.click();
      await page.waitForTimeout(6000);
      report.groupH1 = await page.locator("h1").first().textContent().catch(() => "");
      report.groupText = (await page.locator("body").innerText()).slice(0, 400);
      await page.screenshot({ path: "/tmp/check-group-mobile.png" });
    }
  }

  // 4. Desktop landing
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("http://localhost:8788/", { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: "/tmp/check-landing-desktop.png" });

  console.log(JSON.stringify(report, null, 2));
  await browser.close();
})();
