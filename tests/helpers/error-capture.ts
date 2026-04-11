/**
 * Playwright error capture helper for lowbit-Q E2E tests.
 *
 * Captures browser console messages, page errors, and WASM failures in real-time.
 * On timeout or assertion failure, dumps a structured error summary so root causes
 * are immediately visible in the test output (no more silent timeouts).
 *
 * Usage:
 *   const capture = new ErrorCapture(page);
 *   capture.install();
 *   // ... run test steps ...
 *   await capture.waitForStepStatus(page, 'lowbit-Q変換', 15 * 60_000);
 *   // On failure, the captured error context is included in the assertion message.
 */

import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

interface CapturedEvent {
  ts: number;
  type: 'console' | 'pageerror' | 'wasm-error' | 'network-error';
  level: 'info' | 'warn' | 'error';
  message: string;
}

export class ErrorCapture {
  private events: CapturedEvent[] = [];
  private page: Page;
  private installed = false;

  constructor(page: Page) {
    this.page = page;
  }

  install(): void {
    if (this.installed) return;
    this.installed = true;

    // Capture ALL console messages (not just filtered ones)
    this.page.on('console', (msg) => {
      const text = msg.text();
      const level = msg.type() === 'error' ? 'error' : msg.type() === 'warning' ? 'warn' : 'info';

      this.events.push({
        ts: Date.now(),
        type: 'console',
        level,
        message: text.slice(0, 1000),
      });

      // Always print errors and important messages immediately
      if (level === 'error') {
        console.log(`[CAPTURE:ERROR] ${text.slice(0, 500)}`);
      } else if (
        text.includes('@@INFO[lowbit-q]') ||
        text.includes('generate done') ||
        text.includes('[wllama-error]') ||
        text.includes('model loaded') ||
        text.includes('detected lowbit-Q') ||
        text.includes('PASS') ||
        text.includes('FAIL') ||
        text.includes('ftell') ||
        text.includes('RangeError') ||
        text.includes('Invalid')
      ) {
        console.log(`[CAPTURE:INFO] ${text.slice(0, 300)}`);
      }
    });

    // Capture uncaught page errors
    this.page.on('pageerror', (err) => {
      const msg = `${err.name}: ${err.message}`;
      this.events.push({
        ts: Date.now(),
        type: 'pageerror',
        level: 'error',
        message: msg.slice(0, 1000),
      });
      console.log(`[CAPTURE:PAGE_ERROR] ${msg.slice(0, 500)}`);
    });

    // Capture failed network requests (useful for WASM fetch failures)
    this.page.on('requestfailed', (req) => {
      const msg = `${req.method()} ${req.url()} — ${req.failure()?.errorText ?? 'unknown'}`;
      this.events.push({
        ts: Date.now(),
        type: 'network-error',
        level: 'error',
        message: msg,
      });
      console.log(`[CAPTURE:NET_FAIL] ${msg}`);
    });
  }

  /** Get all captured errors (level=error only) */
  getErrors(): CapturedEvent[] {
    return this.events.filter((e) => e.level === 'error');
  }

  /** Get all captured events */
  getAll(): CapturedEvent[] {
    return [...this.events];
  }

  /** Get a human-readable error summary (last N errors) */
  getErrorSummary(maxErrors = 10): string {
    const errors = this.getErrors();
    if (errors.length === 0) return '(no errors captured)';

    const recent = errors.slice(-maxErrors);
    return recent
      .map((e) => {
        const elapsed = ((e.ts - (this.events[0]?.ts ?? e.ts)) / 1000).toFixed(1);
        return `  [+${elapsed}s ${e.type}] ${e.message.slice(0, 200)}`;
      })
      .join('\n');
  }

  /** Get recent console log context (last N messages of any level) */
  getRecentContext(maxLines = 20): string {
    const recent = this.events.slice(-maxLines);
    return recent
      .map((e) => {
        const elapsed = ((e.ts - (this.events[0]?.ts ?? e.ts)) / 1000).toFixed(1);
        return `  [+${elapsed}s ${e.level}] ${e.message.slice(0, 150)}`;
      })
      .join('\n');
  }

  /** Clear captured events */
  clear(): void {
    this.events = [];
  }
}

// ---------------------------------------------------------------------------
// Enhanced step-waiting helpers
// ---------------------------------------------------------------------------

export function getStepCard(page: Page, stepLabel: string) {
  return page
    .locator('div.rounded-xl.border.p-4')
    .filter({ has: page.locator('.font-medium', { hasText: stepLabel }) });
}

/**
 * Wait for a validation step to reach PASS or FAIL, with error context on timeout.
 *
 * Unlike the original `waitForStepStatus`, on timeout this includes:
 * - All captured browser errors
 * - Recent console context
 * - The step card's current HTML state
 */
export async function waitForStepStatus(
  page: Page,
  stepLabel: string,
  timeout: number,
  capture?: ErrorCapture,
): Promise<{ status: string; detail: string }> {
  const card = getStepCard(page, stepLabel);

  try {
    await expect(async () => {
      const statusEl = card.locator('.uppercase.tracking-wide');
      const text = await statusEl.textContent();
      expect(text?.toLowerCase()).toMatch(/pass|fail/);
    }).toPass({ timeout, intervals: [3_000] });
  } catch (err) {
    // On timeout, build a detailed error report
    const errorContext = capture ? capture.getErrorSummary() : '(no capture installed)';
    const recentContext = capture ? capture.getRecentContext() : '';

    // Try to get current state of the step card
    let cardState = '(could not read)';
    try {
      const statusText = await card.locator('.uppercase.tracking-wide').textContent({ timeout: 2000 });
      const detailText = await card.locator('.opacity-80').textContent({ timeout: 2000 }).catch(() => '');
      cardState = `status="${statusText}", detail="${detailText}"`;
    } catch {
      // card not found
    }

    const report = [
      `Step "${stepLabel}" did not reach PASS/FAIL within ${(timeout / 1000).toFixed(0)}s`,
      `Card state: ${cardState}`,
      `\nCaptured errors:\n${errorContext}`,
      `\nRecent console:\n${recentContext}`,
    ].join('\n');

    console.log(`\n${'='.repeat(60)}`);
    console.log('[STEP_TIMEOUT_REPORT]');
    console.log(report);
    console.log(`${'='.repeat(60)}\n`);

    throw new Error(report);
  }

  const status = (await card.locator('.uppercase.tracking-wide').textContent()) ?? '';
  const detailEl = card.locator('.opacity-80');
  const detail = (await detailEl.count()) > 0 ? ((await detailEl.textContent()) ?? '') : '';
  return { status: status.toLowerCase().trim(), detail };
}

// ---------------------------------------------------------------------------
// Quick WASM smoke test — load a GGUF directly via wllama
// ---------------------------------------------------------------------------

/**
 * Injects a script into the page that loads a GGUF via wllama and returns the result.
 * Captures detailed error info including WASM-level failures.
 */
export async function quickWllamaLoadTest(
  page: Page,
  ggufUrl: string,
  capture?: ErrorCapture,
): Promise<{
  success: boolean;
  loadMs?: number;
  arch?: string;
  output?: string;
  error?: string;
}> {
  const result = await page.evaluate(async (url: string) => {
    try {
      // @ts-expect-error wllama is globally available
      const { Wllama } = await import('/src/vendor/wllama/index.js');
      const wllama = new Wllama({
        'single-thread/wllama.wasm': '/vendor/wllama/single-thread.wasm',
        'multi-thread/wllama.wasm': '/vendor/wllama/multi-thread.wasm',
      });

      const start = performance.now();
      await wllama.loadModelFromUrl(url, { n_ctx: 256, n_threads: 1 });
      const loadMs = Math.round(performance.now() - start);

      const meta = await wllama.getModelMetadata?.() ?? {};
      const arch = meta['general.architecture'] ?? 'unknown';

      // Quick inference test
      const output = await wllama.createCompletion('Hello', { nPredict: 5 });
      await wllama.exit();

      return { success: true, loadMs, arch, output };
    } catch (err: any) {
      return { success: false, error: err?.message ?? String(err) };
    }
  }, ggufUrl);

  if (!result.success && capture) {
    console.log(`[WLLAMA_LOAD_FAIL] ${result.error}`);
    console.log(`[WLLAMA_LOAD_FAIL] Recent errors:\n${capture.getErrorSummary()}`);
  }

  return result;
}

export async function clickButton(page: Page, text: string, timeout = 60_000) {
  const button = page.locator('button', { hasText: text });
  await expect(button).toBeEnabled({ timeout });
  await button.click();
}

export function detectCollapse(output: string): boolean {
  if (output.length === 0) return false;
  const words = output.split(/\s+/).filter(Boolean);
  if (words.length < 10) return false;
  const freq: Record<string, number> = {};
  for (const w of words) freq[w] = (freq[w] ?? 0) + 1;
  return Math.max(...Object.values(freq)) / words.length > 0.4;
}
