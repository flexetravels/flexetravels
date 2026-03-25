// ─── Automation Script Runner ─────────────────────────────────────────────────
// Executes structured AutomationStep arrays against a live Playwright page.
// Steps are atomic — the runner stops at first failure and returns a result
// with the partial progress captured (screenshot + DOM for self-healing).

import type { AutomationStep, ExecutionResult } from '../types';
import { newPage } from './browser';

const STEP_TIMEOUT_MS = 10_000;

export async function runScript(
  steps:      AutomationStep[],
  scriptId?:  string,
  airline?:   string,
  actionType?: string,
): Promise<ExecutionResult> {
  const t0 = Date.now();
  const meta = {
    scriptId:   scriptId  ?? 'unknown',
    airline:    airline    ?? 'unknown',
    actionType: actionType ?? 'unknown',
    totalSteps: steps.length,
  };

  let page: import('playwright-core').Page | undefined;

  try {
    page = await newPage();
  } catch (e) {
    return {
      ...meta,
      success:        false,
      stepsCompleted: 0,
      durationMs:     Date.now() - t0,
      error:          String(e),
    };
  }

  let stepsCompleted = 0;

  try {
    for (const step of steps) {
      switch (step.type) {

        case 'navigate':
          await page.goto(step.url, {
            waitUntil: 'domcontentloaded',
            timeout:   30_000,
          });
          break;

        case 'click':
          await page.waitForSelector(step.selector, { timeout: STEP_TIMEOUT_MS });
          await page.click(step.selector, { timeout: STEP_TIMEOUT_MS });
          break;

        case 'fill':
          await page.waitForSelector(step.selector, { timeout: STEP_TIMEOUT_MS });
          await page.fill(step.selector, step.value, { timeout: STEP_TIMEOUT_MS });
          break;

        case 'select':
          await page.waitForSelector(step.selector, { timeout: STEP_TIMEOUT_MS });
          await page.selectOption(step.selector, step.value, { timeout: STEP_TIMEOUT_MS });
          break;

        case 'wait':
          if (step.selector) {
            await page.waitForSelector(step.selector, { timeout: STEP_TIMEOUT_MS });
          } else {
            await page.waitForTimeout(step.ms ?? 1_000);
          }
          break;

        case 'waitNav':
          await page.waitForNavigation({ timeout: 30_000 });
          break;

        case 'screenshot':
          // Fire-and-forget; used for audit trail, not blocking
          break;

        case 'assert': {
          await page.waitForSelector(step.selector, { timeout: STEP_TIMEOUT_MS });
          if (step.text) {
            const content = await page.textContent(step.selector);
            if (!content?.includes(step.text)) {
              throw new Error(
                `Assertion failed: expected "${step.text}" in selector "${step.selector}"`
              );
            }
          }
          break;
        }
      }

      stepsCompleted++;
    }

    await page.context().close();

    return {
      ...meta,
      success:        true,
      stepsCompleted,
      durationMs:     Date.now() - t0,
    };

  } catch (e) {
    // Capture DOM + screenshot for self-healing
    let screenshotBase64: string | undefined;
    let domSnapshot: string | undefined;

    try {
      const buf = await page.screenshot({ fullPage: false });
      screenshotBase64 = buf.toString('base64');
      domSnapshot = await page.content();
    } catch { /* capture failed — proceed without */ }

    try { await page.context().close(); } catch { /* already closed */ }

    return {
      ...meta,
      success:        false,
      stepsCompleted,
      durationMs:     Date.now() - t0,
      error:          String(e),
      screenshotBase64,
      domSnapshot,
    };
  }
}
