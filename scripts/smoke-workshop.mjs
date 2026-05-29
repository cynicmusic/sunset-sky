import { chromium } from 'playwright';
import { WORKSHOP_CAPTURE_SETTLE_MS } from '../src/config/captureTiming.js';

const url = process.env.SUNSET_SKY_URL || process.env.ISLAND_URL || process.env.SKY_LAB_URL || 'http://127.0.0.1:57210/';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
const pageErrors = [];

try {
  page.on('pageerror', (err) => {
    pageErrors.push(err.message);
    console.error(`pageerror: ${err.message}`);
  });

  const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  if (!response?.ok()) {
    throw new Error(`HTTP ${response?.status() ?? 'unknown'} from ${url}`);
  }

  await page.waitForFunction(() => Boolean(window.sunsetSky || window.island), null, {
    timeout: 90000,
  });

  await page.waitForTimeout(WORKSHOP_CAPTURE_SETTLE_MS);

  const result = await page.evaluate(() => {
    const text = document.body?.innerText || '';
    const island = window.sunsetSky || window.island;
    const wanted = ['takram atmosphere', 'sun', 'atmosphere', 'lighting'];
    return {
      captureSettleMs: island?.captureSettleMs,
      checks: Object.fromEntries(wanted.map((label) => [label, text.includes(label)])),
      panelSequence: text
        .split('\n')
        .map((line) => line.trim().toLowerCase())
        .filter((line) => wanted.includes(line)),
    };
  });

  const missing = Object.entries(result.checks)
    .filter(([, ok]) => !ok)
    .map(([label]) => label);

  if (missing.length) {
    throw new Error(`Missing panel labels after settle: ${missing.join(', ')}`);
  }
  if (pageErrors.length) {
    throw new Error(`Page errors after settle: ${pageErrors.join(' | ')}`);
  }

  console.log(`island smoke ok (${result.captureSettleMs}ms settle)`);
  console.log(`panel sequence: ${result.panelSequence.join(' > ')}`);
} finally {
  await browser.close();
}
