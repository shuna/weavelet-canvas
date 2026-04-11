/**
 * lowbit-Q smoke test — quick verification of WASM + conversion + load.
 *
 * Uses ErrorCapture for immediate error reporting.
 * Tests: SmolLM2 (small, fast), Qwen 3.5 (non-llama arch), Gemma 4 (large, Memory64).
 *
 * Run:
 *   npx playwright test tests/lowbit-q-smoke.spec.ts --headed
 */

import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { ErrorCapture, waitForStepStatus, clickButton, detectCollapse } from './helpers/error-capture';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE_URL = 'http://localhost:5175/?lowbit-q-validation=1';

interface ModelSpec {
  name: string;
  ggufPath: string;
  expectedArch: string;
  /** Expected to pass load? false for known-broken cases */
  expectLoad: boolean;
}

const MODELS: ModelSpec[] = [
  {
    name: 'SmolLM2-1.7B Q4_K_M',
    ggufPath: '/tmp/SmolLM2-1.7B-Instruct-Q4_K_M.gguf',
    expectedArch: 'llama',
    expectLoad: true,
  },
  {
    name: 'Qwen 3.5 2B Q4_K_M',
    ggufPath: '/tmp/Qwen3.5-2B-Q4_K_M.gguf',
    expectedArch: 'qwen35',
    expectLoad: true,
  },
  {
    name: 'Gemma 4 E2B Q4_K_M',
    ggufPath: '/tmp/gemma-4-E2B-it-Q4_K_M.gguf',
    expectedArch: 'gemma4',
    expectLoad: true,  // Now expecting success with Memory64
  },
];

// Single smoke prompt for quick validation
const SMOKE_PROMPT = { id: 'tiny-reasoning', expectPattern: /[0-9５]/ };

interface TestResult {
  model: string;
  available: boolean;
  fileSizeMB: number | null;
  importSuccess: boolean;
  conversionSuccess: boolean;
  loadSuccess: boolean;
  inferenceOutput: string;
  functionalSuccess: boolean;
  errors: string[];
}

const RESULTS_FILE = path.join(__dirname, 'lowbit-q-smoke-results.json');

test.describe.serial('lowbit-Q Smoke Test (Memory64 WASM)', () => {
  let sharedContext: BrowserContext;
  let sharedPage: Page;
  let capture: ErrorCapture;
  const allResults: TestResult[] = [];

  test.beforeAll(async ({ browser }) => {
    sharedContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    sharedPage = await sharedContext.newPage();
    capture = new ErrorCapture(sharedPage);
    capture.install();
  });

  test.afterAll(async () => {
    fs.writeFileSync(RESULTS_FILE, JSON.stringify(allResults, null, 2));
    console.log('\n========== Smoke Test Results ==========');
    console.log('| Model | Size | Import | Convert | Load | Func |');
    console.log('|-------|------|--------|---------|------|------|');
    for (const r of allResults) {
      if (!r.available) {
        console.log(`| ${r.model} | (not found) | - | - | - | - |`);
        continue;
      }
      console.log(
        `| ${r.model} | ${r.fileSizeMB?.toFixed(0) ?? '?'} MB` +
        ` | ${r.importSuccess ? 'YES' : 'NO'}` +
        ` | ${r.conversionSuccess ? 'YES' : 'NO'}` +
        ` | ${r.loadSuccess ? 'YES' : 'NO'}` +
        ` | ${r.functionalSuccess ? 'YES' : 'NO'} |`,
      );
      if (r.errors.length > 0) {
        console.log(`  Errors: ${r.errors.join('; ')}`);
      }
    }
    console.log(`\nResults saved to: ${RESULTS_FILE}`);
    await sharedContext.close();
  });

  for (const model of MODELS) {
    test(`${model.name}: import → convert → load → infer`, async () => {
      test.setTimeout(20 * 60_000);

      const result: TestResult = {
        model: model.name,
        available: false,
        fileSizeMB: null,
        importSuccess: false,
        conversionSuccess: false,
        loadSuccess: false,
        inferenceOutput: '',
        functionalSuccess: false,
        errors: [],
      };

      // Check GGUF availability
      if (!fs.existsSync(model.ggufPath)) {
        console.log(`  SKIP: ${model.ggufPath} not found`);
        allResults.push(result);
        test.skip(true, `GGUF not found: ${model.ggufPath}`);
        return;
      }

      result.available = true;
      result.fileSizeMB = fs.statSync(model.ggufPath).size / (1024 * 1024);
      console.log(`\n--- ${model.name} (${result.fileSizeMB.toFixed(0)} MB) ---`);

      // Clear previous error context
      capture.clear();

      const page = sharedPage;
      await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30_000 });
      await expect(page.locator('text=wllama lowbit-Q 品質診断UI')).toBeVisible();

      // --- Step 1: Import ---
      console.log(`[${model.name}] Importing...`);
      try {
        const [fileChooser] = await Promise.all([
          page.waitForEvent('filechooser', { timeout: 30_000 }),
          clickButton(page, 'ローカルGGUFを読込'),
        ]);
        await fileChooser.setFiles(model.ggufPath);
        const importResult = await waitForStepStatus(page, '元GGUFダウンロード', 5 * 60_000, capture);
        result.importSuccess = importResult.status === 'pass';
        console.log(`[${model.name}] Import: ${importResult.status} — ${importResult.detail}`);
      } catch (err) {
        result.errors.push(`Import failed: ${(err as Error).message.slice(0, 200)}`);
        console.log(`[${model.name}] Import FAILED`);
        allResults.push(result);
        return;
      }

      if (!result.importSuccess) {
        result.errors.push('Import status was not PASS');
        allResults.push(result);
        return;
      }

      // --- Step 2: Select NATIVE-DIRECT (PASSTHROUGH) preset ---
      const presetSelect = page.locator('[data-testid="allocator-preset-select"]');
      await presetSelect.selectOption('v2-native-direct');
      await page.waitForTimeout(300);

      // --- Step 3: Convert ---
      console.log(`[${model.name}] Converting (PASSTHROUGH)...`);
      try {
        await clickButton(page, 'lowbit-Q変換', 30_000);
        const convertResult = await waitForStepStatus(page, 'lowbit-Q変換', 10 * 60_000, capture);
        result.conversionSuccess = convertResult.status === 'pass';
        console.log(`[${model.name}] Convert: ${convertResult.status} — ${convertResult.detail}`);

        if (result.conversionSuccess) {
          await waitForStepStatus(page, 'OPFS保存', 60_000, capture);
        }
      } catch (err) {
        result.errors.push(`Convert failed: ${(err as Error).message.slice(0, 200)}`);
        console.log(`[${model.name}] Convert FAILED`);
        allResults.push(result);
        return;
      }

      if (!result.conversionSuccess) {
        result.errors.push('Conversion status was not PASS');
        allResults.push(result);
        return;
      }

      // --- Step 4: Load + Infer ---
      console.log(`[${model.name}] Loading and inferring...`);
      try {
        await page.locator('input[type="number"][min="8"]').fill('50');
        const promptSelect = page.locator('select').filter({
          has: page.locator('option', { hasText: 'Greeting' }),
        });
        await promptSelect.selectOption({ value: SMOKE_PROMPT.id }).catch(() => undefined);
        await page.waitForTimeout(300);

        await clickButton(page, 'lowbit-Qを実行', 30_000);
        const runResult = await waitForStepStatus(page, 'lowbit-Q load/generate', 5 * 60_000, capture);
        result.loadSuccess = runResult.status === 'pass';
        console.log(`[${model.name}] Run: ${runResult.status} — ${runResult.detail}`);

        if (result.loadSuccess) {
          const outputPre = page.locator('.text-slate-600:has-text("lowbit-Q")').locator('..').locator('pre');
          const output = (await outputPre.textContent().catch(() => '')) ?? '';
          result.inferenceOutput = output.slice(0, 500);
          result.functionalSuccess = SMOKE_PROMPT.expectPattern.test(output) && !detectCollapse(output);
          console.log(`[${model.name}] Output (${output.length} chars): ${output.slice(0, 120)}`);
          console.log(`[${model.name}] Functional: ${result.functionalSuccess}`);
        }
      } catch (err) {
        result.errors.push(`Load/Infer failed: ${(err as Error).message.slice(0, 200)}`);
        console.log(`[${model.name}] Load/Infer FAILED`);
      }

      // Capture any remaining errors
      const capturedErrors = capture.getErrors();
      if (capturedErrors.length > 0) {
        for (const e of capturedErrors.slice(-5)) {
          if (!result.errors.some((existing) => existing.includes(e.message.slice(0, 50)))) {
            result.errors.push(`[${e.type}] ${e.message.slice(0, 200)}`);
          }
        }
      }

      allResults.push(result);
    });
  }
});
