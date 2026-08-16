const { chromium } = require('playwright-core');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error && error.stack || error)));
  await page.goto('http://127.0.0.1:8000/SimFlation-v67.html', { waitUntil: 'load', timeout: 60000 });
  const result = await page.evaluate(async () => {
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
    if (typeof updateLabels === 'function') updateLabels();
    if (typeof runBatchAudit !== 'function') throw new Error('runBatchAudit is unavailable');
    const audit = await runBatchAudit(12, 240);
    return {
      summary: audit.summary,
      seeds: audit.seeds.map(row => ({
        seed: row.seed,
        monthsCompleted: row.monthsCompleted,
        halted: row.halted,
        problems: row.problems,
        bankFailures: row.final.bankFailures,
        unemployment: row.final.unemployment,
        debtRatio: row.final.debtRatio
      }))
    };
  });
  console.log('V67_AUDIT=' + JSON.stringify(result));
  if (pageErrors.length) {
    console.error('PAGE_ERRORS=' + JSON.stringify(pageErrors));
    process.exitCode = 1;
  }
  if (result.summary.integrityFailures !== 0 || result.seeds.some(row => row.halted || row.problems.length)) {
    console.error('Integrity failure in v67 repeated-run audit.');
    process.exitCode = 1;
  }
  await browser.close();
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
