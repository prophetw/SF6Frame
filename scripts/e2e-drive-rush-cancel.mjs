import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const runId = `drive-rush-cancel-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const artifactDir = path.join(root, '.e2e-artifacts', runId);
await mkdir(artifactDir, { recursive: true });
const report = {
  status: 'RUNNING',
  checks: [],
  screenshots: [],
  consoleErrors: [],
  pageErrors: [],
  failedRequests: [],
  httpErrors: [],
  externalRequests: [],
};
let server;
let browser;
let page;

async function check(name, run) {
  await run();
  report.checks.push(name);
  console.log(`PASS ${name}`);
}

async function clickText(selector, text) {
  const elements = await page.$$(selector);
  for (const element of elements) {
    if ((await element.evaluate(node => node.textContent.trim())) === text) {
      const clickable = await element.evaluate(node => {
        node.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
        const bounds = node.getBoundingClientRect();
        return node.contains(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2));
      });
      assert.ok(clickable, `${selector}: ${text} is covered by another element`);
      await element.click();
      return;
    }
  }
  throw new Error(`Cannot find ${selector}: ${text}`);
}

async function selectMove(selector, input) {
  const value = await page.$eval(selector, (select, input) => Array.from(select.options)
    .find(option => option.textContent.trim().split(' · ')[0] === input)?.value, input);
  assert.notEqual(value, undefined, `Missing ${input} option in ${selector}`);
  await page.select(selector, value);
}

async function metrics(gap, advantage, status) {
  await page.waitForFunction(({ gap, advantage, status }) => {
    const result = document.querySelector('.pressure-result');
    return document.querySelector('[data-testid="drc-gap"]')?.textContent.trim() === gap
      && document.querySelector('[data-testid="drc-advantage"]')?.textContent.trim() === advantage
      && (!status || result?.textContent.includes(status));
  }, {}, { gap, advantage, status });
  assert.equal(await page.$eval('.drive-rush-calculator', node => node.querySelectorAll('[role="alert"]').length), 0);
}

async function delay(value) {
  await page.click('#drc-delay', { clickCount: 3 });
  await page.keyboard.press('Backspace');
  if (value !== '') await page.keyboard.type(String(value));
  await page.keyboard.press('Tab');
}

async function preset(input) {
  await clickText('.presets button', `2MK → 绿冲取消 → ${input}`);
}

async function screenshot(name, selector = '.drive-rush-calculator') {
  // Capture the document region without scrolling the card under the sticky navigation.
  await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
  const element = await page.$(selector);
  assert.ok(element);
  const bounds = await element.boundingBox();
  assert.ok(bounds);
  await page.screenshot({ path: path.join(artifactDir, name), clip: bounds, captureBeyondViewport: true });
  report.screenshots.push(name);
}

async function comparisonRows() {
  return page.$$eval('.comparison tbody tr', rows => rows.map(row => ({
    input: row.querySelector('button').textContent.trim().split(' · ')[0],
    status: row.dataset.resultStatus,
    gap: parseInt(row.cells[2].textContent, 10),
  })));
}

async function legacyMove(placeholder, input) {
  const selector = `input[placeholder="${placeholder}"]`;
  await page.click(selector);
  await page.type(selector, input);
  await page.waitForFunction(input => Array.from(document.querySelectorAll('.calculator-grid .dropdown-item'))
    .some(node => node.querySelector('.move-input')?.textContent.trim() === input), {}, input);
  const items = await page.$$('.calculator-grid .dropdown-item');
  for (const item of items) {
    if (await item.evaluate((node, input) => node.querySelector('.move-input')?.textContent.trim() === input, input)) {
      await item.click();
      return;
    }
  }
  throw new Error(`Cannot select legacy move ${input}`);
}

try {
  server = await createServer({ root, logLevel: 'error', server: { host: '127.0.0.1', port: 0, strictPort: false } });
  await server.listen();
  const baseUrl = server.resolvedUrls.local[0];
  const origin = new URL(baseUrl).origin;
  report.url = `${baseUrl}#/gap-calculator`;
  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  page = await browser.newPage();
  page.setDefaultTimeout(10000);
  await page.setViewport({ width: 1365, height: 1000, deviceScaleFactor: 1 });
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

  await check('local route and DRC entry', async () => {
    const response = await page.goto(report.url, { waitUntil: 'networkidle0' });
    assert.equal(response.status(), 200);
    await page.waitForSelector('.calculator-grid .search-input');
    await clickText('.mode-selector .radio-label', '绿冲取消 (DRC)');
    await metrics('-1F', '+3F', '连防');
    assert.equal((await page.$$('.presets button')).length, 2);
  });
  await check('Ryu 2MK → DRC → 5LP and standalone normal filtering', async () => {
    await preset('5LP');
    await metrics('-1F', '+3F', '连防');
    const sources = await page.$$eval('#drc-source option', options => options.map(node => node.textContent.trim().split(' · ')[0]));
    assert.ok(sources.includes('2MK'));
    assert.ok(!sources.includes('5HK') && !sources.includes('5MK'));
    assert.ok(sources.every(input => !/[~>]/.test(input)));
    const targets = await page.$$eval('#drc-follow-up option', options => options.map(node => node.textContent.trim().split(' · ')[0]));
    assert.ok(targets.includes('5LP') && targets.includes('5HP'));
    assert.ok(targets.every(input => !/[~>]/.test(input)));
    assert.equal(await page.$$eval('.comparison td button', buttons => buttons.some(node => /[~>]/.test(node.textContent.split(' · ')[0]))), false);
  });
  await check('Ryu 2MK → DRC → 5HP and formula details', async () => {
    await preset('5HP');
    await metrics('5F', '+2F', '可被 4F 抢动打断');
    await page.click('.pressure-result summary');
    const formula = await page.$eval('.pressure-result details', node => node.innerText);
    assert.match(formula, /3（首招取消）\+ 9（绿冲取消）/);
    assert.match(formula, /-2 \+ 4（绿冲） = \+2F/);
  });
  await check('block comparison defaults to safer pressure and smaller gaps first', async () => {
    const rows = await comparisonRows();
    assert.deepEqual(rows.slice(0, 2).map(row => row.input), ['5LP', '2LP']);
    const gaps = rows.filter(row => row.status !== 'status-unknown').map(row => row.gap);
    assert.ok(gaps.every((gap, index) => index === 0 || gaps[index - 1] <= gap));
    assert.deepEqual(rows.slice(-1).map(row => row.input), ['4HK']);
  });
  await check('comparison row changes selected follow-up', async () => {
    const row = await page.$('.comparison tbody tr:first-child button');
    assert.ok(row);
    await row.click();
    await metrics('-1F', '+3F', '连防');
    assert.match(await page.$eval('#drc-follow-up', select => select.selectedOptions[0].textContent.trim()), /^5LP ·/);
  });
  await check('0F gap permits an invincible reversal', async () => {
    await delay(1);
    await metrics('0F', '+3F', '帧陷阱');
    assert.match(await page.$eval('.pressure-result', node => node.innerText), /启动无敌技/);
  });
  await check('3F gap reaches the 4F trade boundary', async () => {
    await delay(4);
    await metrics('3F', '+3F', '4F 抢动可相杀');
  });
  await check('invalid delays show an error and remove stale results', async () => {
    for (const value of [-1, 0.5, '']) {
      await delay(value);
      await page.waitForFunction(() => document.querySelector('[role="alert"]')?.textContent.includes('额外延迟')
        && !document.querySelector('[data-testid="drc-gap"]'));
    }
    await preset('5HP');
    await metrics('5F', '+2F');
  });
  await check('burnout changes both gap and final advantage', async () => {
    await page.click('.conditions input[type="checkbox"]');
    await metrics('1F', '+6F', '帧陷阱');
    await delay(2);
    await metrics('3F', '+6F', '4F 抢动可相杀');
  });
  await check('presets reset delay and burnout', async () => {
    await preset('5LP');
    await metrics('-1F', '+3F');
    assert.equal(await page.$eval('#drc-delay', node => node.value), '0');
    assert.equal(await page.$eval('.conditions input[type="checkbox"]', node => node.checked), false);
  });
  await check('direct move selection uses DRC timing instead of rapid chains', async () => {
    await selectMove('#drc-source', '5LP');
    await selectMove('#drc-follow-up', '5LP');
    await metrics('4F', '+3F', '可被 4F 抢动打断');
    await selectMove('#drc-source', '2MK');
    await selectMove('#drc-follow-up', '5HP');
    await metrics('5F', '+2F');
  });
  await check('changing character resets moves and conditions', async () => {
    await delay(2);
    await page.click('.conditions input[type="checkbox"]');
    await metrics('3F', '+6F');
    await page.select('.selection-section select', 'ken');
    await page.waitForFunction(() => document.querySelector('#drc-delay')?.value === '0'
      && !document.querySelector('.presets')
      && document.querySelector('#drc-source')?.selectedOptions[0]?.textContent.trim().startsWith('2MK ·'));
    assert.equal(await page.$eval('.conditions input[type="checkbox"]', node => node.checked), false);
    await page.select('.selection-section select', 'ryu');
    await page.waitForSelector('.presets button');
    await metrics('-1F', '+3F');
  });
  await check('existing Link and Cancel modes still work', async () => {
    await clickText('.mode-selector .radio-label', '普通链接 (Link)');
    await page.waitForSelector('.calculator-grid .search-input');
    assert.equal((await page.$$('.drive-rush-calculator')).length, 0);
    await legacyMove('搜索招式 (如: 5MP)', '5LP');
    await legacyMove('搜索招式 (如: 2MP)', '5LP');
    await page.waitForFunction(() => document.querySelector('.result-section .gap-value')?.textContent.trim() === '4F');
    await clickText('.mode-selector .radio-label', '必杀/连招取消 (Cancel)');
    await page.waitForFunction(() => document.querySelector('.result-section .gap-value')?.textContent.trim() === '0F');
  });
  await check('hit mode retains the DRC entry and supports both Ryu examples', async () => {
    await clickText('.type-selector .type-btn', '👊 打中 (Hit/Combo)');
    assert.equal((await page.$$('.mode-selector .radio-label')).length, 3);
    await page.waitForFunction(() => document.querySelector('.result-section')?.textContent.includes('连招成立'));
    await clickText('.mode-selector .radio-label', '绿冲取消 (DRC)');
    await metrics('+7F', '+8F', '连招成立');
    await preset('5HP');
    await metrics('+1F', '+8F', '连招成立');
    assert.equal((await page.$$('.conditions input[type="checkbox"]')).length, 0);
    assert.equal((await page.$$('.error-section')).length, 0);
  });
  await check('counter hit and punish counter are mutually exclusive and affect the starter only', async () => {
    await page.click('#drc-hit-ch');
    await metrics('+3F', '+8F', '连招成立');
    await page.click('#drc-hit-pc');
    await metrics('+5F', '+8F', '连招成立');
    assert.equal(await page.$eval('#drc-hit-ch', node => node.checked), false);
    assert.equal(await page.$eval('#drc-hit-pc', node => node.checked), true);
  });
  await check('hit comparison groups successful routes, near misses and unknowns', async () => {
    const rows = await comparisonRows();
    assert.deepEqual(rows.slice(0, 2).map(row => row.input), ['5LP', '2LP']);
    assert.deepEqual(rows.filter(row => row.status === 'status-danger').map(row => row.input), ['6HK', '6HP', '6MP']);
    assert.deepEqual(rows.slice(-2).map(row => row.input), ['2HK', '4HK']);
    const successful = rows.filter(row => row.status === 'status-safe');
    assert.ok(successful.every((row, index) => index === 0 || successful[index - 1].gap >= row.gap));
    assert.ok(rows.findIndex(row => row.status === 'status-danger') >= successful.length);
  });
  await check('success, failure and unknown badges use visible green, red and gray colors', async () => {
    const colors = await page.evaluate(() => ['status-safe', 'status-danger', 'status-unknown'].map(status => {
      const row = document.querySelector(`.comparison tr[data-result-status="${status}"]`);
      const badge = row.querySelector('.status-badge');
      return { status, color: getComputedStyle(badge).color, gapColor: getComputedStyle(row.cells[2]).color,
        background: getComputedStyle(badge).backgroundColor, text: badge.textContent };
    }));
    assert.deepEqual(colors.map(item => item.color), ['rgb(63, 185, 80)', 'rgb(248, 81, 73)', 'rgb(139, 148, 158)']);
    assert.ok(colors.every(item => item.gapColor === item.color && item.background !== 'rgba(0, 0, 0, 0)'));
    assert.match(colors[0].text, /✓.*连招成立/);
    assert.match(colors[1].text, /✕.*连招失败/);
    assert.match(colors[2].text, /无法计算/);
    await selectMove('#drc-follow-up', '6HK');
    await metrics('1F', '+6F', '连招失败');
    assert.equal(await page.$eval('[data-testid="drc-gap"]', node => getComputedStyle(node).color), 'rgb(248, 81, 73)');
    await selectMove('#drc-follow-up', '5HP');
    await metrics('+5F', '+8F', '连招成立');
    assert.equal(await page.$eval('[data-testid="drc-gap"]', node => getComputedStyle(node).color), 'rgb(63, 185, 80)');
    await screenshot('comparison-hit-sorted-desktop.png', '.comparison');
  });
  await check('alternate sorts keep the selected move and react to counter-state changes', async () => {
    await page.select('#drc-sort', 'advantage');
    await page.waitForFunction(() => document.querySelector('.comparison tbody button')?.textContent.trim().startsWith('5HK ·'));
    await metrics('+5F', '+8F', '连招成立');
    await page.click('#drc-hit-normal');
    await metrics('+1F', '+8F', '连招成立');
    await page.waitForFunction(() => document.querySelector('.comparison tbody button')?.textContent.trim().startsWith('5MP ·'));
    await page.click('#drc-hit-pc');
    await metrics('+5F', '+8F', '连招成立');
    await page.waitForFunction(() => document.querySelector('.comparison tbody button')?.textContent.trim().startsWith('5HK ·'));
    await page.select('#drc-sort', 'startup');
    await page.waitForFunction(() => document.querySelector('.comparison tbody button')?.textContent.trim().startsWith('5LP ·'));
    await page.select('#drc-sort', 'reliability');
    await metrics('+5F', '+8F', '连招成立');
  });
  await check('hit delay reaches the exact combo boundary and then shows missing frames', async () => {
    await delay(5);
    await metrics('+0F', '+8F', '连招成立');
    await delay(6);
    await metrics('1F', '+8F', '连招失败');
    assert.match(await page.$eval('.result-metrics', node => node.innerText), /缺失/);
    await delay(0);
    await metrics('+5F', '+8F', '连招成立');
  });
  await check('switching hit/block keeps moves and applies only the relevant modifiers', async () => {
    await clickText('.type-selector .type-btn', '🛡️ 被防御 (Gap/Block)');
    await metrics('5F', '+2F', '可被 4F 抢动打断');
    assert.equal((await page.$$('#drc-hit-pc')).length, 0);
    await page.click('.conditions input[type="checkbox"]');
    await metrics('1F', '+6F', '帧陷阱');
    await clickText('.type-selector .type-btn', '👊 打中 (Hit/Combo)');
    await metrics('+5F', '+8F', '连招成立');
    assert.equal(await page.$eval('#drc-hit-pc', node => node.checked), true);
    await clickText('.type-selector .type-btn', '🛡️ 被防御 (Gap/Block)');
    await metrics('1F', '+6F', '帧陷阱');
    assert.equal(await page.$eval('.conditions input[type="checkbox"]', node => node.checked), true);
    await clickText('.type-selector .type-btn', '👊 打中 (Hit/Combo)');
  });
  await check('character and preset changes reset counter state', async () => {
    await preset('5LP');
    await metrics('+7F', '+8F', '连招成立');
    assert.equal(await page.$eval('#drc-hit-normal', node => node.checked), true);
    await page.click('#drc-hit-ch');
    await metrics('+9F', '+8F');
    await page.select('.selection-section select', 'ken');
    await page.waitForFunction(() => !document.querySelector('.presets')
      && document.querySelector('#drc-hit-normal')?.checked);
    await page.select('.selection-section select', 'ryu');
    await page.waitForSelector('.presets button');
    await metrics('+7F', '+8F');
    assert.equal(await page.$eval('#drc-hit-normal', node => node.checked), true);
  });
  await check('mobile layout and Ryu 5HP results', async () => {
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
    await clickText('.type-selector .type-btn', '🛡️ 被防御 (Gap/Block)');
    await preset('5HP');
    await metrics('5F', '+2F', '可被 4F 抢动打断');
    const layout = await page.evaluate(() => ({ viewport: innerWidth, width: document.documentElement.scrollWidth,
      cardRight: document.querySelector('.drive-rush-calculator').getBoundingClientRect().right }));
    assert.ok(layout.width <= layout.viewport, `Page overflows horizontally: ${JSON.stringify(layout)}`);
    assert.ok(layout.cardRight <= layout.viewport, `Calculator overflows viewport: ${JSON.stringify(layout)}`);
    await page.click('.conditions input[type="checkbox"]');
    await metrics('1F', '+6F', '帧陷阱');
    await clickText('.type-selector .type-btn', '👊 打中 (Hit/Combo)');
    await page.click('#drc-hit-ch');
    await metrics('+3F', '+8F', '连招成立');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.ok(await page.$eval('#drc-sort', node => {
      const bounds = node.getBoundingClientRect();
      return bounds.width > 0 && bounds.right <= innerWidth;
    }));
    await screenshot('comparison-hit-sorted-mobile.png', '.comparison');
  });
  await check('no unexpected UI errors, console errors or failed HTTP requests', async () => {
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
  if (page) {
    await page.screenshot({ path: path.join(artifactDir, 'failure.png'), fullPage: true }).catch(() => {});
  }
  console.error(report.error);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (server) await server.close();
  await writeFile(path.join(artifactDir, 'result.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ status: report.status, checks: report.checks.length, artifactDir }));
}
