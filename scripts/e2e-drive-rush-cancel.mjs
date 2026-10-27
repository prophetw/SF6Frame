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

async function screenshot(name) {
  const element = await page.$('.drive-rush-calculator');
  assert.ok(element);
  await element.screenshot({ path: path.join(artifactDir, name) });
  report.screenshots.push(name);
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
    await screenshot('ryu-5lp-desktop.png');
  });
  await check('Ryu 2MK → DRC → 5HP and formula details', async () => {
    await preset('5HP');
    await metrics('5F', '+2F', '可被 4F 抢动打断');
    await page.click('.pressure-result summary');
    const formula = await page.$eval('.pressure-result details', node => node.innerText);
    assert.match(formula, /3（首招取消）\+ 9（绿冲取消）/);
    assert.match(formula, /-2 \+ 4（绿冲） = \+2F/);
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
  await check('hit-mode switching hides DRC and returning restores the entry', async () => {
    await clickText('.type-selector .type-btn', '👊 连招确认 (Link/Combo)');
    assert.equal((await page.$$('.mode-selector .radio-label')).length, 2);
    await page.waitForFunction(() => document.querySelector('.result-section')?.textContent.includes('连招成立'));
    await clickText('.type-selector .type-btn', '🛡️ 压制空隙 (Gap/Block)');
    await clickText('.mode-selector .radio-label', '绿冲取消 (DRC)');
    await metrics('-1F', '+3F');
    assert.equal((await page.$$('.error-section')).length, 0);
  });
  await check('mobile layout and Ryu 5HP results', async () => {
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
    await preset('5HP');
    await metrics('5F', '+2F', '可被 4F 抢动打断');
    const layout = await page.evaluate(() => ({ viewport: innerWidth, width: document.documentElement.scrollWidth,
      cardRight: document.querySelector('.drive-rush-calculator').getBoundingClientRect().right }));
    assert.ok(layout.width <= layout.viewport, `Page overflows horizontally: ${JSON.stringify(layout)}`);
    assert.ok(layout.cardRight <= layout.viewport, `Calculator overflows viewport: ${JSON.stringify(layout)}`);
    await screenshot('ryu-5hp-mobile.png');
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
