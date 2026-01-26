/**
 * Google Meet Puppeteer Bot
 *
 * Joins Meet calls, enables captions, scrapes them from the DOM,
 * and emits transcript events for processing.
 */

// @ts-ignore - puppeteer-extra types available when package is installed
import puppeteer from "puppeteer-extra";
// @ts-ignore - stealth plugin
import StealthPlugin from "puppeteer-extra-plugin-stealth";
// @ts-ignore - puppeteer types available when package is installed
import type { Browser, Page } from "puppeteer";

// Add stealth plugin to avoid bot detection
puppeteer.use(StealthPlugin());
import { EventEmitter } from "events";
import { SELECTORS } from "./selectors";
import * as fs from "fs";
import * as path from "path";

const AUTH_FILE = path.join(process.cwd(), "meet-auth.json");

export interface CaptionEvent {
  speaker: string;
  text: string;
  timestamp: Date;
  isFinal: boolean;
}

export interface MeetBotConfig {
  meetUrl: string;
  displayName: string;
  headless: boolean;
  captionLanguage?: string;
}

export interface MeetBotEvents {
  joined: [];
  caption: [CaptionEvent];
  captionsEnabled: [];
  error: [Error];
  stopped: [];
}

export class MeetBot extends EventEmitter {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private config: MeetBotConfig;
  private isRunning = false;
  private captionBuffer = "";
  private currentSpeaker = "";
  private lastCaptionTime = 0;
  private scrapeInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config: MeetBotConfig) {
    super();
    this.config = config;
  }

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    try {
      console.log(`[meet-bot] Launching browser for ${this.config.meetUrl}`);

      // Force visible browser for debugging - set to "new" for headless
      this.browser = await puppeteer.launch({
        headless: false,  // TEMPORARY: force visible for debugging
        args: [
          "--use-fake-ui-for-media-stream",
          "--use-fake-device-for-media-stream",
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-blink-features=AutomationControlled",
          "--disable-infobars",
          "--window-size=1280,720",
        ],
        ignoreDefaultArgs: ["--enable-automation"],
      });

      this.page = await this.browser.newPage();

      await this.page.setViewport({ width: 1280, height: 720 });
      await this.page.setUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
      );

      // Additional stealth: Override webdriver property
      await this.page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
      });

      // Load saved auth session if available
      if (fs.existsSync(AUTH_FILE)) {
        try {
          const authData = JSON.parse(fs.readFileSync(AUTH_FILE, "utf-8"));
          if (authData.cookies && authData.cookies.length > 0) {
            await this.page.setCookie(...authData.cookies);
            console.log(`[meet-bot] Loaded ${authData.cookies.length} cookies from auth session`);
          }
        } catch (err) {
          console.log(`[meet-bot] Could not load auth session: ${err}`);
        }
      } else {
        console.log(`[meet-bot] No auth session found (${AUTH_FILE}). Running as guest.`);
      }

      // Grant camera/mic permissions
      const context = this.browser.defaultBrowserContext();
      await context.overridePermissions("https://meet.google.com", [
        "camera",
        "microphone",
      ]);

      console.log(`[meet-bot] Navigating to ${this.config.meetUrl}`);
      await this.page.goto(this.config.meetUrl, {
        waitUntil: "networkidle2",
        timeout: 60000,
      });

      await this.handlePreJoin();
      await this.joinMeeting();
      await this.enableCaptions();
      this.startCaptionScraping();
    } catch (err) {
      console.error(`[meet-bot] Start error:`, err);
      this.emit("error", err as Error);
      await this.stop();
    }
  }

  private async handlePreJoin(): Promise<void> {
    if (!this.page) return;

    console.log(`[meet-bot] Handling pre-join screen`);

    // Wait for page to fully load and stabilize
    await new Promise((r) => setTimeout(r, 3000));

    // Take a screenshot for debugging
    try {
      await this.page.screenshot({ path: '/tmp/meet-prejoin.png' });
      console.log(`[meet-bot] Screenshot saved to /tmp/meet-prejoin.png`);
    } catch {
      // Ignore screenshot errors
    }

    // Try to enter name if input is visible
    try {
      const nameInput = await this.page.$(SELECTORS.nameInput);
      if (nameInput) {
        await nameInput.click({ clickCount: 3 });
        await nameInput.type(this.config.displayName);
        console.log(`[meet-bot] Entered display name: ${this.config.displayName}`);
      }
    } catch {
      console.log(`[meet-bot] No name input found`);
    }

    // Try to click "Continue without microphone and camera" if present
    try {
      const continueBtn = await this.page.$('button');
      const buttons = await this.page.$$('button');
      for (const btn of buttons) {
        const text = await btn.evaluate((el) => el.textContent);
        if (text?.includes('Continue without')) {
          await btn.click();
          console.log(`[meet-bot] Clicked "Continue without microphone and camera"`);
          await new Promise((r) => setTimeout(r, 1000));
          break;
        }
      }
    } catch {
      // Not present
    }

    // Turn off camera/mic if buttons are visible
    try {
      const buttons = await this.page.$$('button');
      for (const btn of buttons) {
        const label = await btn.evaluate((el) => el.getAttribute('aria-label') || '');
        if (label.toLowerCase().includes('turn off microphone')) {
          await btn.click();
          console.log(`[meet-bot] Turned off microphone`);
        } else if (label.toLowerCase().includes('turn off camera')) {
          await btn.click();
          console.log(`[meet-bot] Turned off camera`);
        }
      }
    } catch {
      // Already off or not present
    }

    // Dismiss any "Got it" popups
    try {
      const buttons = await this.page.$$('button');
      for (const btn of buttons) {
        const text = await btn.evaluate((el) => el.textContent);
        if (text?.includes('Got it')) {
          await btn.click();
          console.log(`[meet-bot] Dismissed "Got it" popup`);
        }
      }
    } catch {
      // Not present
    }
  }

  private async joinMeeting(): Promise<void> {
    if (!this.page) return;

    console.log(`[meet-bot] Attempting to join meeting`);

    // Log all visible buttons for debugging
    const allButtons = await this.page.$$eval('button', (btns) =>
      btns.map((b) => b.textContent?.trim()).filter(Boolean)
    );
    console.log(`[meet-bot] Visible buttons: ${allButtons.join(', ')}`);

    // Try various join button texts (from recall.ai reference)
    const joinTexts = [
      "Join now",
      "Ask to join",
      "Join meeting",
      "Join call",
      "Join",
      "Done",
      "Continue",
    ];

    let clicked = false;
    for (const text of joinTexts) {
      try {
        const buttons = await this.page.$$('button');
        for (const btn of buttons) {
          const btnText = await btn.evaluate((el) => el.textContent?.trim());
          if (btnText && btnText.toLowerCase().includes(text.toLowerCase())) {
            await btn.click();
            console.log(`[meet-bot] Clicked join button: "${btnText}"`);
            clicked = true;
            break;
          }
        }
        if (clicked) break;
      } catch {
        // Try next
      }
    }

    if (!clicked) {
      // Fallback: press Enter
      console.log(`[meet-bot] No join button found, pressing Enter`);
      await this.page.keyboard.press('Enter');
    }

    // Wait for indicators that we're in the meeting
    console.log(`[meet-bot] Waiting to be admitted...`);

    const inMeeting = await Promise.race([
      this.page.waitForSelector('button[aria-label*="Leave call"]', { timeout: 120000 }).then(() => 'leave-button'),
      // @ts-ignore - runs in browser context
      this.page.waitForFunction(() => (globalThis as any).document.body.innerText.includes("You've been admitted"), { timeout: 120000 }).then(() => 'admitted'),
      // @ts-ignore - runs in browser context
      this.page.waitForFunction(() => (globalThis as any).document.body.innerText.includes("You're the only one here"), { timeout: 120000 }).then(() => 'alone'),
      // @ts-ignore - runs in browser context
      this.page.waitForFunction(() => (globalThis as any).document.body.innerText.includes("You can't join"), { timeout: 120000 }).then(() => 'blocked'),
    ]).catch(() => 'timeout');

    if (inMeeting === 'blocked') {
      throw new Error('Meeting blocked external guests - cannot join');
    }

    if (inMeeting === 'timeout') {
      throw new Error('Timed out waiting to be admitted to meeting');
    }

    console.log(`[meet-bot] Successfully joined meeting (${inMeeting})`);
    this.emit("joined");
  }

  private async enableCaptions(): Promise<void> {
    if (!this.page) return;

    console.log(`[meet-bot] Enabling captions`);

    // Wait for UI to stabilize after joining
    await new Promise((r) => setTimeout(r, 5000));

    // Dismiss any overlays by pressing Escape a few times
    for (let i = 0; i < 3; i++) {
      await this.page.keyboard.press('Escape');
      await new Promise((r) => setTimeout(r, 300));
    }

    // Try keyboard shortcut Shift+C (Google Meet's caption toggle)
    for (let i = 0; i < 5; i++) {
      console.log(`[meet-bot] Attempt ${i + 1}: Pressing Shift+C for captions`);
      await this.page.keyboard.down('Shift');
      await this.page.keyboard.press('c');
      await this.page.keyboard.up('Shift');

      // Check if captions region appeared
      await new Promise((r) => setTimeout(r, 1000));

      const captionsOn = await this.page.$('[role="region"][aria-label*="Captions"]');
      if (captionsOn) {
        console.log(`[meet-bot] Captions enabled via Shift+C`);
        this.emit("captionsEnabled");
        return;
      }

      // Check if "Turn off captions" button is visible (means captions are on)
      const ccOffBtn = await this.page.$('button[aria-label*="Turn off captions"]');
      if (ccOffBtn) {
        console.log(`[meet-bot] Captions already enabled`);
        this.emit("captionsEnabled");
        return;
      }
    }

    // Fallback: try clicking the caption button
    console.log(`[meet-bot] Shift+C failed, trying button click...`);

    // Move mouse to trigger toolbar
    await this.page.mouse.move(500, 700);
    await new Promise((r) => setTimeout(r, 500));

    try {
      const ccButton = await this.page.$('button[aria-label*="Turn on captions"]');
      if (ccButton) {
        await ccButton.click();
        console.log(`[meet-bot] Enabled captions via button`);
        this.emit("captionsEnabled");
        return;
      }
    } catch {
      // Button not found
    }

    console.log(`[meet-bot] Warning: Could not confirm captions are enabled`);
  }

  private startCaptionScraping(): void {
    if (!this.page) return;

    console.log(`[meet-bot] Starting caption scraping`);

    this.scrapeInterval = setInterval(async () => {
      if (!this.isRunning || !this.page) {
        if (this.scrapeInterval) {
          clearInterval(this.scrapeInterval);
          this.scrapeInterval = null;
        }
        return;
      }

      try {
        const selectorsArg = {
          captionContainer: SELECTORS.captionContainer,
          captionEntry: SELECTORS.captionEntry,
          speakerName: SELECTORS.speakerName,
          captionText: SELECTORS.captionText,
        };

        const captions = await this.page.evaluate((selectors: typeof selectorsArg) => {
          // This code runs in browser context
          const containers = (globalThis as any).document.querySelectorAll(selectors.captionContainer);
          const entries: { speaker: string; text: string }[] = [];

          for (const container of containers) {
            const captionElements = container.querySelectorAll(selectors.captionEntry);

            for (const el of captionElements) {
              const speakerEl = el.querySelector(selectors.speakerName);
              const textEl = el.querySelector(selectors.captionText);

              const speaker = speakerEl?.textContent?.trim() || "Unknown";
              const text = textEl?.textContent?.trim() || "";

              if (text) {
                entries.push({ speaker, text });
              }
            }
          }

          return entries;
        }, selectorsArg);

        if (captions && captions.length > 0) {
          this.processCaptions(captions);
        }
      } catch {
        // Page may have navigated or element not found
      }
    }, 200);
  }

  private processCaptions(entries: { speaker: string; text: string }[]): void {
    const now = Date.now();

    for (const entry of entries) {
      const speakerChanged = entry.speaker !== this.currentSpeaker;
      const pauseDetected = now - this.lastCaptionTime > 2000;

      // Emit final caption for previous speaker
      if ((speakerChanged || pauseDetected) && this.captionBuffer.trim()) {
        this.emit("caption", {
          speaker: this.currentSpeaker || "Unknown",
          text: this.captionBuffer.trim(),
          timestamp: new Date(),
          isFinal: true,
        } as CaptionEvent);
        this.captionBuffer = "";
      }

      this.currentSpeaker = entry.speaker;
      this.lastCaptionTime = now;

      // Append new text if not already in buffer
      if (!this.captionBuffer.includes(entry.text)) {
        this.captionBuffer += " " + entry.text;

        // Emit interim caption
        this.emit("caption", {
          speaker: entry.speaker,
          text: entry.text,
          timestamp: new Date(),
          isFinal: false,
        } as CaptionEvent);
      }
    }
  }

  async stop(): Promise<void> {
    console.log(`[meet-bot] Stopping bot`);
    this.isRunning = false;

    if (this.scrapeInterval) {
      clearInterval(this.scrapeInterval);
      this.scrapeInterval = null;
    }

    // Flush remaining buffer
    if (this.captionBuffer.trim()) {
      this.emit("caption", {
        speaker: this.currentSpeaker || "Unknown",
        text: this.captionBuffer.trim(),
        timestamp: new Date(),
        isFinal: true,
      } as CaptionEvent);
    }

    // Try to leave meeting gracefully
    if (this.page) {
      try {
        const leaveBtn = await this.page.$(SELECTORS.leaveButton);
        if (leaveBtn) {
          await leaveBtn.click();
        }
      } catch {
        // Ignore leave errors
      }

      await this.page.close().catch(() => {});
      this.page = null;
    }

    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
    }

    this.emit("stopped");
  }

  isActive(): boolean {
    return this.isRunning;
  }
}
