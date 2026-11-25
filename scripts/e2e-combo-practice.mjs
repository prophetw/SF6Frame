import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import puppeteer from 'puppeteer';

const root = fileURLToPath(new URL('..', import.meta.url));
const runId = 'combo-practice-' + new Date().toISOString().replace(/[:.]/g, '-');
const artifacts = path.join(root, '.e2e-artifacts', runId);
const server = await createServer({ root, logLevel: 'error', server: { host: '127.0.0.1', port: 0 } });
let browser;

try {
  await server.listen();
  const base = server.resolvedUrls.local[0];
  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('response', response => { if (response.status() >= 400) errors.push(response.status() + ' ' + response.url()); });
  page.on('requestfailed', request => errors.push(request.url() + ' ' + request.failure()?.errorText));
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(base, { waitUntil: 'networkidle0' });
  await page.click('a[href="#/character/cammy"]');
  await page.waitForSelector('.practice');
  const visibleCount = () => page.$$eval('.practice .route', rows => rows.filter(row => row.checkVisibility()).length);
  assert.equal(await visibleCount(), 3);
  assert.match(await page.$eval('.practice', node => node.innerText), /贴身连续点两下站轻拳/);
  assert.match(await page.$eval('.overview-grid', node => node.innerText), /精选连段\s*9/);

  const scenarios = await page.$$('.scenario');
  for (const scenario of scenarios) {
    await (await scenario.$('summary')).click();
    const groupCount = await scenario.$$eval('.route', routes => routes.length);
    assert.equal(await visibleCount(), groupCount + 2);
    await (await scenario.$('summary')).click();
    assert.equal(await visibleCount(), 3);
  }
  await page.click('.notation summary');
  assert.match(await page.$eval('.notation', node => node.innerText), /↓↘→/);
  await page.click('.notation summary');
  await page.click('.sources summary');
  assert.ok(await page.$eval('.sources a[href*="cammy"]', node => node.checkVisibility()));
  await page.click('.sources summary');

  await mkdir(artifacts, { recursive: true });
  await (await page.$('.practice')).screenshot({ path: path.join(artifacts, 'cammy.png') });

  await page.click('.combo-panel .section-head');
  await page.type('.combo-panel .search-input', '236MK');
  assert.ok(await page.$eval('.combo-sections', node => node.querySelectorAll('.combo-card').length > 0));
  assert.equal(await visibleCount(), 3);

  // Change character in the same SPA, including one without a scraped combo library.
  await page.setViewport({ width: 390, height: 844, isMobile: true });
  await page.click('.back-btn');
  await page.click('a[href="#/character/arjun"]');
  await page.waitForFunction(() => document.querySelector('.practice')?.innerText.includes('轻巨腕击倒'));
  assert.equal(await visibleCount(), 3);
  const mobile = await page.$eval('.practice', node => ({
    fits: node.getBoundingClientRect().right <= window.innerWidth,
    stacked: node.querySelectorAll('.scenario')[1].getBoundingClientRect().top >= node.querySelector('.scenario').getBoundingClientRect().bottom,
  }));
  assert.deepEqual(mobile, { fits: true, stacked: true });
  await page.click('.scenario:last-child summary');
  assert.equal(await visibleCount(), 5);
  await page.click('.combo-panel .section-head');
  assert.match(await page.$eval('.combo-panel', node => node.innerText), /没有抓取连段数据/);
  // Keep the character view mounted while an earlier guide finishes loading.
  const pendingGuide = Promise.withResolvers();
  const intercepted = Promise.withResolvers();
  await page.setRequestInterception(true);
  page.on('request', async request => {
    if (new URL(request.url()).pathname.endsWith('/combo-guides/ryu.json')) {
      intercepted.resolve();
      await pendingGuide.promise;
    }
    await request.continue();
  });
  const timeout = setTimeout(() => intercepted.reject(new Error('未收到隆的连段请求')), 5000);
  try {
    await page.evaluate(() => { location.hash = '/character/ryu'; });
    await intercepted.promise;
    await page.evaluate(() => { location.hash = '/character/ken'; });
    await page.waitForFunction(() => document.querySelector('.practice')?.innerText.includes('跑动龙卷'));
  } finally {
    clearTimeout(timeout);
    pendingGuide.resolve();
  }
  await page.waitForNetworkIdle();
  assert.match(await page.$eval('.practice', node => node.innerText), /跑动龙卷/);
  assert.equal(await visibleCount(), 3);
  assert.deepEqual(errors, []);
  console.log('PASS 角色入口、三个场景、读法与来源、连段库筛选及无原始连段库角色的移动布局。');
  console.log(path.join(artifacts, 'cammy.png'));
} finally {
  await browser?.close();
  await server.close();
}
