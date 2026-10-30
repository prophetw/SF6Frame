import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const runId = `oki-pressure-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const artifactDir = path.join(root, '.e2e-artifacts', runId);
await mkdir(artifactDir, { recursive: true });
const report = {
  status: 'RUNNING', checks: [], screenshots: [],
  consoleErrors: [], pageErrors: [], failedRequests: [], httpErrors: [], externalRequests: [],
};
let server;
let browser;
let page;

async function check(name, run) {
  await run();
  report.checks.push(name);
  console.log(`PASS ${name}`);
}

async function fill(selector, value) {
  await page.$eval(selector, node => node.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }));
  await page.click(selector);
  assert.equal(await page.$eval(selector, node => node === document.activeElement), true, `${selector} must have keyboard focus`);
  await page.keyboard.down('Control');
  await page.keyboard.press('A');
  await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
  if (String(value)) await page.keyboard.type(String(value));
  assert.equal(await page.$eval(selector, node => node.value), String(value), `${selector} must accept the requested input`);
  await page.keyboard.press('Tab');
}

async function overheadMetrics(wakeup, range, guard, trade = false) {
  await page.waitForFunction(({ wakeup, range, guard, trade }) => {
    const row = document.querySelector('.oki-results-table .result-row-auto');
    if (!row) return false;
    return row.querySelector('.combo-prefix')?.textContent.trim() === '绿冲'
      && row.querySelector('.move-input')?.textContent.trim() === '6MP'
      && row.querySelector('.oki-hit-window')?.textContent.trim() === '31~34F'
      && row.querySelector('.oki-wakeup-frame')?.textContent.trim() === wakeup
      && row.querySelector('.safe-pressure-range')?.textContent.trim() === range
      && row.querySelector('.di-guard-badge')?.textContent.trim() === guard
      && row.classList.contains('trade') === trade;
  }, {}, { wakeup, range, guard, trade });
}

async function screenshot(name, selector) {
  // Capture the document region without moving it underneath the sticky navigation.
  await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
  const element = await page.$(selector);
  assert.ok(element);
  const bounds = await element.boundingBox();
  assert.ok(bounds);
  await page.screenshot({ path: path.join(artifactDir, name), clip: bounds, captureBeyondViewport: true });
  report.screenshots.push(name);
}

try {
  server = await createServer({ root, logLevel: 'error', server: { host: '127.0.0.1', port: 0 } });
  await server.listen();
  const baseUrl = server.resolvedUrls.local[0];
  const origin = new URL(baseUrl).origin;
  report.url = `${baseUrl}#/oki`;
  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  page = await browser.newPage();
  page.setDefaultTimeout(10000);
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  page.on('console', message => {
    if (message.type() === 'error') report.consoleErrors.push(message.text());
  });
  page.on('pageerror', error => report.pageErrors.push(String(error)));
  page.on('requestfailed', request => report.failedRequests.push({ url: request.url(), error: request.failure()?.errorText }));
  page.on('response', response => {
    if (response.status() >= 400) report.httpErrors.push({ url: response.url(), status: response.status() });
  });
  await page.setRequestInterception(true);
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.origin === origin || ['data:', 'blob:'].includes(url.protocol)) {
      void request.continue();
    } else {
      report.externalRequests.push(request.url());
      void request.abort();
    }
  });

  await check('local /oki loads Ryu and calculates the +28F overhead setup', async () => {
    const response = await page.goto(report.url, { waitUntil: 'networkidle0' });
    assert.equal(response.status(), 200);
    await page.select('select.character-select', 'ryu');
    await page.waitForSelector('.custom-kd-btn');
    await page.click('.custom-kd-btn');
    await fill('.custom-kd-input input', 28);
    await fill('.auto-match-search-input', '6MP');
    await overheadMetrics('29F', '29~34F', '可防');
  });

  await check('desktop columns align and distinguish DI from drive reversal', async () => {
    const layout = await page.evaluate(() => {
      const table = document.querySelector('.oki-results-table');
      const headers = Array.from(table.querySelector('.result-header').children);
      const cells = Array.from(table.querySelector('.result-row-auto').children);
      return {
        labels: headers.map(node => node.textContent.trim().replace(/[↓↑]/g, '').trim()),
        positionsMatch: headers.every((node, index) => Math.abs(node.getBoundingClientRect().x - cells[index].getBoundingClientRect().x) < 1),
        driveReversal: cells[6].textContent.trim(),
        driveImpact: cells[7].textContent.trim(),
        tooltip: cells[7].title,
        pageWidth: document.documentElement.scrollWidth,
        viewport: innerWidth,
      };
    });
    assert.deepEqual(layout.labels, ['组合', '打击时序', '起身帧', '适用起身范围', '容错', '空挥先动', '防斗反', '防 DI', '被防', '被击打康加2', '相杀']);
    assert.equal(layout.positionsMatch, true);
    assert.equal(layout.driveReversal, '不可防');
    assert.equal(layout.driveImpact, '可防');
    assert.match(layout.tooltip, /恢复 54F.*DI 生效 54F.*余量 0F/);
    assert.ok(layout.pageWidth <= layout.viewport);
  });

  await check('calculation rules collapse while current wakeup and startup remain visible', async () => {
    assert.equal(await page.$eval('.oki-calculation-notes', node => node.open), false);
    assert.match(await page.$eval('.oki-context-summary', node => node.textContent), /起身 29F.*对 4F 抢招/);
    await page.click('.oki-calculation-notes summary');
    await page.waitForFunction(() => document.querySelector('.oki-calculation-notes').open);
    assert.match(await page.$eval('.oki-calculation-notes', node => node.innerText), /空挥先动/);
    await page.click('.oki-calculation-notes summary');
    assert.equal(await page.$eval('.oki-calculation-notes', node => node.open), false);
  });

  await check('route memory groups existing custom and character knockdowns', async () => {
    await page.click('.oki-results-table .result-row-auto .result-combo');
    await page.waitForSelector('.oki-results-table .route-memory');
    const memory = await page.$eval('.oki-results-table .route-memory', node => ({
      text: node.textContent,
      current: node.querySelector('.current')?.textContent,
      groups: Array.from(node.querySelectorAll('.memory-advantage')).map(item => item.textContent.trim()),
    }));
    assert.match(memory.text, /\+28~\+33F/);
    assert.match(memory.text, /214HP\+绿冲/);
    assert.match(memory.text, /235HK623MP/);
    assert.match(memory.current, /\+28F/);
    assert.deepEqual(memory.groups, ['+28F 起身 29F', '+29F 起身 30F', '+32F 起身 33F']);
    await screenshot('desktop-overhead-details.png', '.oki-results-table');
  });

  await check('changing ordinary startup widens pressure without changing DI startup', async () => {
    await fill('.opponent-info input[type="number"]', 6);
    await overheadMetrics('29F', '27~34F', '可防');
    assert.match(await page.$eval('.di-guard-badge', node => node.title), /DI 生效 54F/);
    await fill('.opponent-info input[type="number"]', 4);
    await overheadMetrics('29F', '29~34F', '可防');
  });

  await check('one frame earlier becomes a trade and cannot directly block DI', async () => {
    await fill('.custom-kd-input input', 27);
    await overheadMetrics('28F', '29~34F', '不可直防', true);
    assert.match(await page.$eval('.di-guard-badge', node => node.title), /恢复 54F.*DI 生效 53F.*晚了 1F/);
  });

  await check('1F startup has no safe pressure range and no memory recommendations', async () => {
    await fill('.custom-kd-input input', 30);
    await fill('.opponent-info input[type="number"]', 1);
    await overheadMetrics('31F', '-', '可防', true);
    const memory = await page.$eval('.oki-results-table .route-memory', node => node.textContent);
    assert.match(memory, /没有可复用的安全压制区间/);
    await fill('.opponent-info input[type="number"]', 4);
    await fill('.custom-kd-input input', 28);
    await overheadMetrics('29F', '29~34F', '可防');
  });

  await check('sorting and search still operate on the full result list', async () => {
    await fill('.auto-match-search-input', '');
    await page.click('.oki-results-table .result-header > span:nth-child(2)');
    await page.waitForFunction(() => document.querySelector('.oki-results-table .result-header > span:nth-child(2) .sort-indicator')?.textContent.trim() === '↑');
    const startups = await page.$$eval('.oki-results-table .oki-hit-window', nodes => nodes.map(node => parseInt(node.textContent, 10)));
    assert.ok(startups.length > 1);
    assert.ok(startups.every((value, index) => index === 0 || value >= startups[index - 1]));
    await fill('.auto-match-search-input', '6MP');
    await overheadMetrics('29F', '29~34F', '可防');
    assert.equal((await page.$$('.oki-results-table .result-row-auto')).length, 1);
  });

  await check('mobile exposes the same ranges, DI status and memory without page overflow', async () => {
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
    await page.waitForSelector('.mobile-result-card', { visible: true });
    const mobile = await page.$eval('.mobile-result-card', node => ({
      text: node.querySelector('.card-tags-row').textContent,
      memory: node.querySelector('.route-memory')?.textContent,
      bounds: { left: node.getBoundingClientRect().left, right: node.getBoundingClientRect().right },
      pageWidth: document.documentElement.scrollWidth,
      viewport: innerWidth,
    }));
    assert.match(mobile.text, /防 DI: 可防/);
    assert.match(mobile.text, /打击: 31~34F/);
    assert.match(mobile.text, /起身: 29F/);
    assert.match(mobile.text, /适用起身范围: 29~34F/);
    assert.match(mobile.memory, /\+28~\+33F/);
    assert.ok(mobile.pageWidth <= mobile.viewport);
    assert.ok(mobile.bounds.left >= 0 && mobile.bounds.right <= mobile.viewport);
    await screenshot('mobile-overhead-details.png', '.mobile-result-card');
  });

  await check('mobile timeline opens and closes with the new details intact', async () => {
    await page.click('.mobile-result-card .detail-toggle-btn');
    await page.waitForSelector('.mobile-result-card .mobile-timeline-wrapper .frame-block');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.click('.mobile-result-card .detail-toggle-btn');
    await page.waitForSelector('.mobile-result-card .mobile-timeline-wrapper', { hidden: true });
  });

  await check('mobile DI failure is visible and selecting a saved knockdown restores the safe setup', async () => {
    await fill('.custom-kd-input input', 27);
    await overheadMetrics('28F', '29~34F', '不可直防', true);
    assert.match(await page.$eval('.mobile-result-card .di-guard-status', node => node.textContent), /不可直防/);
    await screenshot('mobile-di-boundary.png', '.mobile-result-card');
    const saved = await page.$$('.saved-moves-grid .knockdown-card');
    let selected = false;
    for (const card of saved) {
      if (await card.evaluate(node => node.querySelector('.move-name')?.textContent.trim() === '214HP+绿冲')) {
        await card.click();
        selected = true;
        break;
      }
    }
    assert.equal(selected, true);
    await overheadMetrics('29F', '29~34F', '可防');
    assert.equal((await page.$$('.custom-kd-input')).length, 0);
    assert.match(await page.$eval('.mobile-result-card .route-memory .current', node => node.textContent), /\+28F/);
  });

  await check('whiff recovery lead occupies its own desktop column and mobile metric', async () => {
    await page.click('.custom-kd-btn');
    await fill('.custom-kd-input input', 23);
    await fill('.auto-match-search-input', '5LK');
    await page.waitForFunction(() => Array.from(document.querySelectorAll('.oki-results-table .result-row-auto')).some(row =>
      !row.querySelector('.combo-prefix') && row.querySelector('.move-input')?.textContent.trim() === '5LK'
      && row.querySelector('.oki-whiff-lead')?.textContent.trim() === '+5F'));
    await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
    const whiff = await page.$$eval('.oki-results-table .result-row-auto', rows => {
      const row = rows.find(node => !node.querySelector('.combo-prefix') && node.querySelector('.move-input')?.textContent.trim() === '5LK');
      return { tag: row.querySelector('.tag-badge').textContent.trim(), lead: row.querySelector('.oki-whiff-lead').textContent.trim(),
        primary: row.querySelector('.oki-combo-primary').textContent, block: row.children[8].textContent.trim(), hit: row.children[9].textContent.trim() };
    });
    assert.deepEqual({ tag: whiff.tag, lead: whiff.lead, block: whiff.block, hit: whiff.hit }, { tag: '空挥', lead: '+5F', block: '-', hit: '-' });
    assert.doesNotMatch(whiff.primary, /\+5/);
    await screenshot('desktop-whiff-list.png', '.oki-results-table');
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
    const cards = await page.$$('.mobile-result-card');
    let whiffCard;
    for (const card of cards) {
      if (await card.evaluate(node => !node.querySelector('.mob-prefix') && node.querySelector('.mob-move-input')?.textContent.trim() === '(5LK)')) {
        whiffCard = card;
        break;
      }
    }
    assert.ok(whiffCard);
    assert.match(await whiffCard.$eval('.oki-whiff-lead', node => node.textContent), /空挥先动: \+5F/);
    assert.equal(await page.$eval('.oki-calculation-notes', node => node.open), false);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await screenshot('mobile-whiff-card.png', '.mobile-result-card');
  });

  await check('no visible UI errors, console errors or failed HTTP requests', async () => {
    const uiErrors = await page.$$eval('[role="alert"], .error-section, .toast-error', nodes => nodes
      .filter(node => node.getClientRects().length).map(node => node.textContent.trim()));
    assert.deepEqual(uiErrors, []);
    for (const key of ['consoleErrors', 'pageErrors', 'failedRequests', 'httpErrors', 'externalRequests']) {
      assert.deepEqual(report[key], [], key);
    }
  });
  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL';
  report.error = error.stack ?? String(error);
  if (page) report.state = await page.evaluate(() => ({
    inputs: Array.from(document.querySelectorAll('.custom-kd-input input, .opponent-info input, .auto-match-search-input')).map(node => ({ value: node.value, placeholder: node.placeholder })),
    rows: Array.from(document.querySelectorAll('.oki-results-table .result-row-auto')).map(node => ({ classes: node.className, text: node.textContent })),
  })).catch(() => null);
  if (page) await page.screenshot({ path: path.join(artifactDir, 'failure.png'), fullPage: true }).catch(() => {});
  console.error(report.error);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (server) await server.close();
  await writeFile(path.join(artifactDir, 'result.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ status: report.status, checks: report.checks.length, artifactDir }));
}
