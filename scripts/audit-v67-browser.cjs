const { chromium } = require('playwright-core');

async function auditPage(browser, path) {
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error && error.stack || error)));
  await page.goto(`http://127.0.0.1:8000/${path}`, { waitUntil: 'load', timeout: 60000 });

  await page.locator('#capitalRequirement').fill('10');
  await page.locator('#bankPolicy').selectOption('resolve');
  await page.locator('#seed').fill('42');

  const auditButton = page.locator('#runAuditSuite');
  await auditButton.click();
  await page.waitForFunction(() => {
    const status = document.getElementById('batchAuditStatus');
    const text = status?.textContent || '';
    return /Audit complete|could not be completed/i.test(text);
  }, { timeout: 180000 });

  const status = await page.locator('#batchAuditStatus').innerText();
  const text = await page.locator('#batchAuditResults').innerText();
  const completion = text.match(/(\d+) of (\d+) seeds completed with no integrity failure/i);
  const failureMatch = text.match(/([\d,]+) bank failures occurred across all runs/i);
  const result = {
    path,
    status,
    text,
    completedWithoutIntegrityFailure: completion ? Number(completion[1]) : null,
    seedCount: completion ? Number(completion[2]) : null,
    bankFailures: failureMatch ? Number(failureMatch[1].replace(/,/g, '')) : null,
    pageErrors
  };
  await page.close();
  return result;
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const v66 = await auditPage(browser, 'SimFlation-v66.html');
  const v67 = await auditPage(browser, 'SimFlation-v67.html');
  await browser.close();

  console.log('V66_AUDIT=' + JSON.stringify(v66));
  console.log('V67_AUDIT=' + JSON.stringify(v67));

  if (v67.pageErrors.length) {
    console.error('V67_PAGE_ERRORS=' + JSON.stringify(v67.pageErrors));
    process.exitCode = 1;
  }
  if (v67.completedWithoutIntegrityFailure !== v67.seedCount || v67.seedCount !== 12) {
    console.error('Integrity failure in v67 repeated-run audit.');
    process.exitCode = 1;
  }
  if (!Number.isFinite(v66.bankFailures) || !Number.isFinite(v67.bankFailures)) {
    console.error('Could not parse bank-failure totals from the simulator audit output.');
    process.exitCode = 1;
  } else if (v67.bankFailures >= v66.bankFailures) {
    console.error(`Bank failures did not improve: v66 ${v66.bankFailures}, v67 ${v67.bankFailures}.`);
    process.exitCode = 1;
  }
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
