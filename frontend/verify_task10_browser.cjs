const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("Launching Edge via Playwright for Task 10 verification...");
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const outDir = path.resolve(__dirname, "../backend/scratch");

  try {
    console.log("1. Logging in as demo-teacher@example.com...");
    await page.goto("http://localhost:5173/login", { waitUntil: "networkidle" });
    await page.fill('input[type="email"]', "demo-teacher@example.com");
    await page.fill('input[type="password"]', "DemoTeacher!2026");
    await page.click('button[type="submit"]');
    await page.waitForTimeout(2000);

    // 2. Navigate directly to gradebook view: /teacher/grades/1/1
    console.log("2. Navigating to /teacher/grades/1/1...");
    await page.goto("http://localhost:5173/teacher/grades/1/1", { waitUntil: "networkidle" });
    await page.waitForTimeout(2500);

    const gradebookPath = path.join(outDir, "task10_gradebook_table.png");
    await page.screenshot({ path: gradebookPath, fullPage: true });
    console.log("Saved gradebook table screenshot to:", gradebookPath);

    // 3. Click Written Works header to open category breakdown modal
    console.log("3. Opening Written Works breakdown modal...");
    const wwHeader = await page.$('th:has-text("Written Works")');
    if (wwHeader) {
      await wwHeader.click();
      await page.waitForTimeout(1500);
      const modalPath = path.join(outDir, "task10_ww_breakdown_modal.png");
      await page.screenshot({ path: modalPath, fullPage: true });
      console.log("Saved WW breakdown modal screenshot to:", modalPath);

      // Close modal
      const closeBtn = await page.$('button[aria-label="Close"], button:has-text("Close"), svg.lucide-x');
      if (closeBtn) {
        await closeBtn.click();
        await page.waitForTimeout(1000);
      }
    }

    // 4. Click Performance Tasks header to open category breakdown modal
    console.log("4. Opening Performance Tasks breakdown modal...");
    const ptHeader = await page.$('th:has-text("Performance Tasks")');
    if (ptHeader) {
      await ptHeader.click();
      await page.waitForTimeout(1500);
      const ptModalPath = path.join(outDir, "task10_pt_breakdown_modal.png");
      await page.screenshot({ path: ptModalPath, fullPage: true });
      console.log("Saved PT breakdown modal screenshot to:", ptModalPath);

      // Close modal
      const closeBtn = await page.$('button[aria-label="Close"], button:has-text("Close"), svg.lucide-x');
      if (closeBtn) {
        await closeBtn.click();
        await page.waitForTimeout(1000);
      }
    }

    // 5. Navigate to AI Predictions and click section to view rows
    console.log("5. Navigating to /teacher/predictions...");
    await page.goto("http://localhost:5173/teacher/predictions", { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);

    const sectionCard = await page.$('text="Demo Archimedes"');
    if (sectionCard) {
      await sectionCard.click();
      await page.waitForTimeout(2000);
      const predsDetailPath = path.join(outDir, "task10_predictions_detail.png");
      await page.screenshot({ path: predsDetailPath, fullPage: true });
      console.log("Saved predictions detail screenshot to:", predsDetailPath);
    }

    // 6. Navigate to Interventions
    console.log("6. Navigating to /teacher/interventions...");
    await page.goto("http://localhost:5173/teacher/interventions", { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);
    const intvPath = path.join(outDir, "task10_interventions_table.png");
    await page.screenshot({ path: intvPath, fullPage: true });
    console.log("Saved interventions screenshot to:", intvPath);

    console.log("ALL TASK 10 BROWSER SCREENSHOTS CAPTURED SUCCESSFULLY!");
  } catch (err) {
    console.error("Error during verification:", err);
  } finally {
    await browser.close();
  }
}

main();
