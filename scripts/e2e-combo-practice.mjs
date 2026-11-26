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
  assert.equal(await page.$('.practice .route-oki, .practice .has-oki'), null);
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

  await page.setViewport({ width: 390, height: 844, isMobile: true });
  await page.click('.back-btn');
  await page.click('a[href="#/character/jamie"]');
  const normalRoutes = '.scenario:first-child .more-routes';
  await page.waitForSelector(`${normalRoutes} .has-oki`, { visible: true });
  assert.match(await page.$eval(`${normalRoutes} > summary`, node => node.innerText), /更多常规命中.*含击倒后续/s);
  await page.click(`${normalRoutes} > summary`);
  const jamieRoute = await page.$(`${normalRoutes} > .route:has(.route-oki)`);
  assert.ok(jamieRoute);
  assert.equal(await jamieRoute.$eval(':scope > code', node => node.textContent.trim()), '2LP → 5LK~LK → 623HK');
  assert.ok(await jamieRoute.$eval('.route-oki', node => node.checkVisibility()));
  assert.match(await jamieRoute.$eval('.route-oki > p', node => node.innerText), /重张弓腿击倒 \+39F/);
  assert.equal(await jamieRoute.$eval('.route-oki-details', node => node.open), false);
  await (await jamieRoute.$('.route-oki-details > summary')).click();
  const followup = await jamieRoute.$eval('.route-oki-details', node => node.innerText);
  assert.match(followup, /2LP → 5LK~LK → 623LK/);
  assert.match(followup, /轻张弓腿击倒 \+42F.*两次普通前冲.*\+4F.*5LK/);
  assert.match(followup, /原地受身或后受身.*未.*验证/);
  assert.ok(await jamieRoute.$eval('.route-oki-details', node => {
    const bounds = node.getBoundingClientRect();
    return innerWidth === 390 && bounds.left >= 0 && bounds.right <= innerWidth;
  }));

  const calculatorLink = await jamieRoute.$('.calculator-link');
  const calculatorHash = '#/oki?character=jamie&move=623LK&advantage=42';
  assert.equal(await calculatorLink.evaluate(node => node.hash), calculatorHash);
  const screenshot = path.join(artifacts, 'jamie-oki-mobile.png');
  await jamieRoute.screenshot({ path: screenshot });
  await calculatorLink.click();
  const selectedPreset = '.knockdown-grid .knockdown-card[aria-pressed="true"]';
  await page.waitForSelector(selectedPreset, { visible: true });
  await page.waitForSelector('.oki-context-summary', { visible: true });
  assert.equal(new URL(page.url()).hash, calculatorHash);
  assert.equal(await page.$eval('.oki-view select.character-select', node => node.value), 'jamie');
  assert.equal(await page.$eval(`${selectedPreset} .move-input`, node => node.textContent.trim()), '623LK');
  assert.equal(await page.$eval(`${selectedPreset} .move-advantage`, node => node.textContent.trim()), '+42F');
  assert.match(await page.$eval('.oki-context-summary', node => node.innerText), /起身\s*43F/);

  // Return through browser history and switch to a character without a scraped combo library.
  await page.goBack();
  await page.waitForSelector('.back-btn', { visible: true });
  await page.click('.back-btn');
  await page.click('a[href="#/character/arjun"]');
  await page.waitForFunction(() => document.querySelector('.practice')?.innerText.includes('轻巨腕击倒'));
  assert.equal(await visibleCount(), 3);
  assert.equal(await page.$('.practice .route-oki, .practice .has-oki'), null);
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
  await page.evaluate(() => { location.hash = '/character/ryu'; });
  await page.waitForFunction(() => document.querySelector('.pressure-card code')?.textContent === '2LK → 2LP → 5LP → 214LP');
  assert.match(await page.$eval('.pressure-panel', node => node.innerText), /4F 普通技相打/);
  assert.ok(await page.$eval('.pressure-card a', link => link.href.includes('z4sUshxK9WE') && link.checkVisibility()));
  assert.ok(await page.$$eval('.pressure-card', cards => cards.every(card => card.getBoundingClientRect().right <= innerWidth)));
  await page.click('.scenario:last-child summary');
  assert.match(await page.$eval('.scenario:last-child', node => node.innerText), /裸 DR → 6MP → 2MP → 623HP/);
  await (await page.$('.pressure-panel')).screenshot({ path: path.join(artifacts, 'ryu-pressure.png') });
  assert.deepEqual(errors, []);
  console.log('PASS 角色切换、精选连段、杰米移动端击倒后续与压起身计算器、隆的绿冲中段、移动端压制卡和来源。');
  console.log(screenshot);
} finally {
  await browser?.close();
  await server.close();
}
