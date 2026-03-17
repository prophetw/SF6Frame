import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import * as fs from 'fs';
puppeteer.use(StealthPlugin());
async function main() {
    const browser = await puppeteer.connect({ browserURL: 'http://localhost:9222' });
    const pages = await browser.pages();
    const page = pages.find(p => p.url().toLowerCase().includes('/combos'));
    if (!page) { console.log('not found'); process.exit(1); }
    
    const html = await page.evaluate(() => {
        const content = document.querySelector('#mw-content-text');
        return content ? content.innerHTML : '';
    });
    fs.writeFileSync('/tmp/full-combos.html', html);
    browser.disconnect();
}
main().catch(console.error);
