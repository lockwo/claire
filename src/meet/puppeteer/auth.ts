/**
 * Google Meet Authentication Script
 *
 * Opens a browser for the user to log into Google.
 * Saves the session to auth.json for the bot to use.
 *
 * Run with: bun run meet-auth
 */

// @ts-ignore
import puppeteer from "puppeteer-extra";
// @ts-ignore
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import * as fs from "fs";
import * as path from "path";

puppeteer.use(StealthPlugin());

const AUTH_FILE = path.join(process.cwd(), "meet-auth.json");

async function main() {
  console.log("=== Google Meet Authentication ===\n");
  console.log("A browser will open. Please log into the Google account you want the bot to use.");
  console.log("Once logged in, navigate to meet.google.com and press Enter in this terminal.\n");

  const browser = await puppeteer.launch({
    headless: false,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--disable-infobars",
      "--window-size=1280,800",
    ],
    ignoreDefaultArgs: ["--enable-automation"],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.setUserAgent(
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
  );

  // Navigate to Google Meet (will redirect to login if needed)
  await page.goto("https://meet.google.com", { waitUntil: "networkidle2" });

  // Wait for user to complete login
  console.log("Waiting for you to log in...");
  console.log("Press Enter when you're logged in and see the Meet homepage.\n");

  await new Promise<void>((resolve) => {
    process.stdin.once("data", () => resolve());
  });

  // Save cookies
  const cookies = await page.cookies();
  const localStorage = await page.evaluate(() => {
    // @ts-ignore - runs in browser context
    const storage = (globalThis as any).window?.localStorage;
    if (!storage) return {};
    const data: Record<string, string> = {};
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key) {
        data[key] = storage.getItem(key) || "";
      }
    }
    return data;
  });

  const authData = {
    cookies,
    localStorage,
    savedAt: new Date().toISOString(),
  };

  fs.writeFileSync(AUTH_FILE, JSON.stringify(authData, null, 2));
  console.log(`\nSession saved to ${AUTH_FILE}`);
  console.log("The bot will now use this account to join meetings.\n");

  await browser.close();
  process.exit(0);
}

main().catch((err) => {
  console.error("Auth error:", err);
  process.exit(1);
});
