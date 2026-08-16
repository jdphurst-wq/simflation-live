const { chromium } = require('playwright-core');

async function load(page, path) {
  await page.goto(`http://127.0.0.1:8000/${path}`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => !!window.__sim?.runBatchAudit, null, { timeout: 60000 });
}

async function configure(page) {
  await page.evaluate(() => {
    const set = (id, value) => {
      const el = document.getElementById(id);
      if (!el) throw new Error(`Missing control ${id}`);
      el.value = String(value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    set('capitalRequirement', 10);
    set('bankPolicy', 'resolve');
    set('seed', 42);
  });
}

async function timedBatch(page, seeds = 2, months = 360) {
  await configure(page);
  return page.evaluate(async ({ seeds, months }) => {
    const started = performance.now();
    const audit = await window.__sim.runBatchAudit(seeds, months);
    return { elapsedMs: performance.now() - started, summary: audit.summary, seeds: audit.seeds };
  }, { seeds, months });
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const oldPage = await browser.newPage();
  const newPage = await browser.newPage();
  const errors = [];
  oldPage.on('pageerror', e => errors.push(`0.10.0: ${e && e.stack || e}`));
  newPage.on('pageerror', e => errors.push(`0.11.0: ${e && e.stack || e}`));

  await load(oldPage, 'SimFlation-0.10.0.html');
  const oldBench = await timedBatch(oldPage);
  await oldPage.close();

  await load(newPage, 'SimFlation-0.11.0.html');
  const newBench = await timedBatch(newPage);
  await configure(newPage);
  const longRun = await newPage.evaluate(() => {
    if (!window.__sim?.runLongAudit) throw new Error('0.11.0 long-run audit API unavailable');
    return window.__sim.runLongAudit(1200, 42);
  });

  const release = await newPage.evaluate(() => ({
    title: document.title,
    badge: document.querySelector('.edition-badge')?.textContent?.trim(),
    current: window.__simflationCurrent ? {
      version: window.__simflationCurrent.version,
      releaseVersion: window.__simflationCurrent.releaseVersion,
      modelVersion: window.__simflationCurrent.modelVersion
    } : null
  }));
  await browser.close();

  const ratio = newBench.elapsedMs / Math.max(1, oldBench.elapsedMs);
  const result = { oldBench, newBench, performanceRatio: ratio, longRun, release, errors };
  console.log('SIMFLATION_0_11_AUDIT=' + JSON.stringify(result));

  if (errors.length) throw new Error(`Browser errors: ${JSON.stringify(errors)}`);
  if (newBench.summary.integrityFailures !== 0 || newBench.summary.completedWithoutIntegrityFailure !== 2) {
    throw new Error('0.11.0 failed the repeated 30-year integrity audit.');
  }
  if (ratio > 1.10) throw new Error(`0.11.0 performance regressed materially versus 0.10.0: ratio ${ratio.toFixed(3)}`);
  if (longRun.halted || longRun.problems.length) throw new Error(`Long-run integrity failure: ${JSON.stringify(longRun.problems)}`);
  if (longRun.maxBridgeAge > 60) throw new Error(`Bridge bank exceeded five-year resolution horizon: ${longRun.maxBridgeAge} months`);
  if (longRun.maxConsecutiveOneBank > 18) throw new Error(`Banking system remained at one bank for ${longRun.maxConsecutiveOneBank} consecutive months`);
  if (longRun.successfulPrivateEntrants < 1) throw new Error('No successful ordinary private bank entrant appeared in the 100-year audit.');
  if (release.title !== 'SimFlation 0.11.0' || release.badge !== '0.11.0' || release.current?.version !== '0.11.0' || release.current?.modelVersion !== '0.11.0') {
    throw new Error(`Release identity mismatch: ${JSON.stringify(release)}`);
  }
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
