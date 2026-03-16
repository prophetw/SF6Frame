/**
 * SF6 Combo Data Scraper (Puppeteer)
 * 
 * Scrapes combo data from Supercombo Wiki's /Combos pages.
 * 
 * Usage:
 *   pnpm exec tsx scripts/scraper-combos.ts [character] [--connect] [--host <ip>]
 * 
 *   --connect     : Connect to an existing browser (default: localhost:9222)
 *   --host <ip>   : Specify host IP (useful for WSL2 -> Windows)
 * 
 *   Example:
 *     pnpm exec tsx scripts/scraper-combos.ts akuma --connect
 */

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { CHARACTERS, type CharacterConfig } from './characters';

puppeteer.use(StealthPlugin());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface Combo {
    combo: string;
    position?: string;
    damage?: string;
    superMeter?: string;
    driveMeter?: string;
    difficulty?: string;
    notes?: string;
    videoUrl?: string;
    section: string;
    starter?: string;
}

interface ComboData {
    characterId: string;
    combos: Combo[];
    comboTheory?: string;
    lastUpdated: string;
}

const OUTPUT_DIR = path.join(__dirname, '../src/data/combos');

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

function cleanText(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
}

async function scrapeCharacterCombos(browser: any, config: CharacterConfig): Promise<ComboData | null> {
    console.log(`Scraping combos for ${config.name}...`);
    const comboUrl = `${config.wikiUrl}/Combos`;

    let page;
    let reusedPage = false;

    // Check for existing pages - match specifically the /Combos URL path
    const pages = await browser.pages();
    const comboUrlLower = comboUrl.toLowerCase();
    const existingPage = pages.find((p: any) => {
        const url = p.url().toLowerCase();
        return url.includes('supercombo.gg') && url.includes('/combos');
    });

    if (existingPage) {
        console.log(`  🔄 Found existing Combos tab. Reusing...`);
        page = existingPage;
        reusedPage = true;
        await page.bringToFront();
        
        // Make sure we're on the right character's combo page
        const currentUrl = page.url().toLowerCase();
        if (!currentUrl.includes(config.name.toLowerCase())) {
            console.log(`  ↪ Navigating to ${config.name}'s combo page...`);
            await page.goto(comboUrl, { waitUntil: 'networkidle2', timeout: 60000 });
            reusedPage = false; // Treat as fresh navigation
        }
    } else {
        console.log(`  ✨ Opening new tab for combos...`);
        page = await browser.newPage();
        await page.setViewport({ width: 1920, height: 1080 });
    }

    try {
        if (!reusedPage) {
            console.log(`  🌐 Navigating to: ${comboUrl}`);
            await page.goto(comboUrl, { waitUntil: 'networkidle2', timeout: 60000 });
            await page.mouse.move(100, 100);
            await new Promise(r => setTimeout(r, 2000));
        }

        // Wait for content
        try {
            await page.waitForSelector('#mw-content-text', { timeout: 5000 });
        } catch {
            console.log('  ⚠️ No content found yet.');
            if (reusedPage) {
                console.log('  🔄 Reloading...');
                await page.reload({ waitUntil: 'domcontentloaded' });
                try {
                    await page.waitForSelector('#mw-content-text', { timeout: 5000 });
                } catch { /* continue */ }
            }

            const found = await page.$('#mw-content-text');
            if (!found) {
                console.log('  🔴 ACTION REQUIRED: Please manually navigate/solve CAPTCHA.');
                console.log('     Waiting for content...');
                await page.waitForSelector('#mw-content-text', { timeout: 0 });
            }
        }

        // Scrape combo data from the page
        const scrapeScript = `
(() => {
    const combos = [];
    const contentEl = document.querySelector('#mw-content-text .mw-parser-output') 
                   || document.querySelector('#mw-content-text');
    if (!contentEl) return { combos: [], comboTheory: '' };

    // Helper: find section heading for an element
    function findParentHeadings(el) {
        const result = { h2: '', h3: '', h4: '' };
        let current = el;
        
        while (current && current !== contentEl) {
            // Check previous siblings
            let prev = current.previousElementSibling;
            while (prev) {
                const headingEl = prev.querySelector && prev.querySelector('h2, h3, h4');
                const tag = headingEl ? headingEl.tagName.toLowerCase() : prev.tagName?.toLowerCase();
                const text = headingEl ? headingEl.textContent : prev.textContent;
                
                if (tag === 'h2' && !result.h2) result.h2 = (text || '').replace(/\\[edit\\]/g, '').trim();
                if (tag === 'h3' && !result.h3) result.h3 = (text || '').replace(/\\[edit\\]/g, '').trim();
                if (tag === 'h4' && !result.h4) result.h4 = (text || '').replace(/\\[edit\\]/g, '').trim();
                
                // Also check if prev contains a heading div (citizen theme)
                const headingDiv = prev.querySelector && prev.querySelector('.mw-heading');
                if (headingDiv) {
                    const hEl = headingDiv.querySelector('h2, h3, h4');
                    if (hEl) {
                        const hTag = hEl.tagName.toLowerCase();
                        const hText = (hEl.textContent || '').replace(/\\[edit\\]/g, '').trim();
                        if (hTag === 'h2' && !result.h2) result.h2 = hText;
                        if (hTag === 'h3' && !result.h3) result.h3 = hText;
                        if (hTag === 'h4' && !result.h4) result.h4 = hText;
                    }
                }
                
                prev = prev.previousElementSibling;
            }
            current = current.parentElement;
        }
        return result;
    }

    // 1. Scrape sf6-combotable tables (rich combo tables with damage/difficulty etc.)
    const comboTables = document.querySelectorAll('table.sf6-combotable');
    
    for (const table of comboTables) {
        const headings = findParentHeadings(table);
        const section = headings.h2 || 'Combos';
        const subsection = headings.h3 || '';
        
        // Parse headers
        const headerRow = table.querySelector('tr:first-child');
        if (!headerRow) continue;
        const headers = Array.from(headerRow.querySelectorAll('th, td')).map(
            el => (el.textContent || '').trim().toLowerCase()
        );
        
        const idx = {
            combo: headers.findIndex(h => h.includes('combo') || h.includes('recipe') || h.includes('route')),
            position: headers.findIndex(h => h.includes('position') || h.includes('location') || h.includes('pos')),
            damage: headers.findIndex(h => h.includes('damage') || h.includes('dmg')),
            super: headers.findIndex(h => h.includes('super') || h.includes('sa') || h.includes('meter')),
            drive: headers.findIndex(h => h.includes('drive') || h.includes('dg') || h.includes('gauge')),
            difficulty: headers.findIndex(h => h.includes('difficulty') || h.includes('diff')),
            notes: headers.findIndex(h => h.includes('notes') || h.includes('note')),
            video: headers.findIndex(h => h.includes('video') || h.includes('vid')),
        };
        
        // If combo index not found, try index 0
        if (idx.combo === -1) idx.combo = 0;
        
        const rows = table.querySelectorAll('tr');
        for (let r = 1; r < rows.length; r++) {
            const cells = rows[r].querySelectorAll('td');
            if (cells.length === 0) continue;
            
            const getCell = (index) => {
                if (index === -1 || index >= cells.length) return undefined;
                return (cells[index].textContent || '').replace(/\\n/g, ' ').trim() || undefined;
            };
            
            const getVideoLink = (index) => {
                if (index === -1 || index >= cells.length) return undefined;
                const link = cells[index].querySelector('a[href]');
                return link ? link.getAttribute('href') : undefined;
            };
            
            const comboText = getCell(idx.combo);
            if (!comboText) continue;
            
            combos.push({
                combo: comboText,
                position: getCell(idx.position),
                damage: getCell(idx.damage),
                superMeter: getCell(idx.super),
                driveMeter: getCell(idx.drive),
                difficulty: getCell(idx.difficulty),
                notes: getCell(idx.notes),
                videoUrl: getVideoLink(idx.video),
                section: subsection ? section + ' / ' + subsection : section,
            });
        }
    }

    // 2. Scrape regular wikitable tables in the Combo Lists section
    // These have a simpler structure: first row often has header-like content
    const allTables = document.querySelectorAll('table.wikitable:not(.sf6-combotable):not(.mw-collapsible)');
    
    for (const table of allTables) {
        const headings = findParentHeadings(table);
        const section = headings.h2 || 'Combos';
        
        // Skip non-combo tables (stats tables, notation guides, etc.)
        const firstHeader = table.querySelector('tr:first-child th, tr:first-child td');
        if (!firstHeader) continue;
        const headerText = (firstHeader.textContent || '').trim().toLowerCase();
        if (headerText.includes('health') || headerText.includes('notation') || headerText.includes('meaning')) continue;
        
        // Parse headers
        const headerCells = Array.from(table.querySelectorAll('tr:first-child th, tr:first-child td'));
        const headers = headerCells.map(el => (el.textContent || '').trim().toLowerCase());
        
        const comboIdx = headers.findIndex(h => h.includes('combo') || h.includes('route'));
        const notesIdx = headers.findIndex(h => h.includes('notes') || h.includes('note'));
        
        // For "Combo Lists" style: first row after header IS the starter
        // Structure: first data row has Combo and Notes as a "starter" + description
        // Subsequent rows are combo variants
        const rows = table.querySelectorAll('tr');
        let starter = '';
        
        // Check if this looks like a combo list table
        // The first "data" row often serves as the starter/category
        for (let r = 0; r < rows.length; r++) {
            const cells = rows[r].querySelectorAll('td');
            const thCells = rows[r].querySelectorAll('th');
            
            if (cells.length === 0 && thCells.length >= 2) {
                // This is a header row in "Combo Lists" format
                // The first th after "Combo"/"Notes" headers gives the starter
                // Actually in the data: first th row has [Combo, Notes], 
                // then next th row has [starter combo, description] 
                // Hmm, let me handle both patterns
                const firstTh = (thCells[0].textContent || '').trim();
                const secondTh = thCells.length > 1 ? (thCells[1].textContent || '').trim() : '';
                
                if (firstTh.toLowerCase() === 'combo' || firstTh.toLowerCase() === 'notes') {
                    continue; // Skip actual header row
                }
                
                // This is a starter row (th cells contain starter info)
                starter = firstTh;
                if (starter && secondTh) {
                    combos.push({
                        combo: starter,
                        notes: secondTh,
                        section: section,
                        starter: starter,
                    });
                }
                continue;
            }
            
            if (cells.length === 0) continue;
            
            const getCell = (index) => {
                if (index === -1 || index >= cells.length) return undefined;
                return (cells[index].textContent || '').replace(/\\n/g, ' ').trim() || undefined;
            };
            
            const comboText = getCell(comboIdx !== -1 ? comboIdx : 0);
            if (!comboText) continue;
            
            combos.push({
                combo: comboText,
                notes: getCell(notesIdx !== -1 ? notesIdx : 1),
                section: section,
                starter: starter || undefined,
            });
        }
    }

    // 3. Extract Combo Theory section content
    let comboTheory = '';
    const theoryHeading = Array.from(document.querySelectorAll('h2, .mw-heading h2')).find(
        h => (h.textContent || '').toLowerCase().includes('combo theory')
    );
    if (theoryHeading) {
        const section = theoryHeading.closest('.citizen-section') || theoryHeading.closest('section');
        let theoryContainer = section;
        if (!theoryContainer) {
            // Walk next siblings until next h2
            theoryContainer = theoryHeading.parentElement;
        }
        if (theoryContainer) {
            // Get all direct text/paragraph content, skip tables
            const textParts = [];
            let el = theoryHeading.nextElementSibling || (theoryHeading.parentElement && theoryHeading.parentElement.nextElementSibling);
            while (el) {
                if (el.tagName === 'H2' || el.querySelector && el.querySelector('h2')) break;
                if (el.tagName === 'P' || el.tagName === 'UL' || el.tagName === 'OL') {
                    textParts.push((el.textContent || '').trim());
                }
                // Also check for heading divs
                const subHeading = el.querySelector && el.querySelector('h3, h4');
                if (subHeading) {
                    textParts.push('\\n### ' + (subHeading.textContent || '').trim());
                }
                el = el.nextElementSibling;
            }
            comboTheory = textParts.filter(Boolean).join('\\n');
        }
    }

    return { combos, comboTheory: comboTheory || '' };
})()
        `;

        const scrapeResult = await page.evaluate(scrapeScript);

        if (!reusedPage) {
            await page.close();
        }

        if (!scrapeResult || !scrapeResult.combos || scrapeResult.combos.length === 0) {
            console.warn(`  Warning: No combos found for ${config.name}`);
            return null;
        }

        // Clean up combo data
        const cleanedCombos: Combo[] = scrapeResult.combos.map((c: any) => {
            const combo: Combo = {
                combo: cleanText(c.combo),
                section: cleanText(c.section || 'Combos'),
            };
            if (c.position) combo.position = cleanText(c.position);
            if (c.damage) combo.damage = cleanText(c.damage);
            if (c.superMeter && c.superMeter !== '-') combo.superMeter = cleanText(c.superMeter);
            if (c.driveMeter && c.driveMeter !== '-') combo.driveMeter = cleanText(c.driveMeter);
            if (c.difficulty) combo.difficulty = cleanText(c.difficulty);
            if (c.notes) combo.notes = cleanText(c.notes);
            if (c.videoUrl) combo.videoUrl = c.videoUrl;
            if (c.starter) combo.starter = cleanText(c.starter);
            return combo;
        }).filter((c: Combo) => c.combo.length > 0);

        // Remove duplicates
        const seen = new Set<string>();
        const dedupedCombos = cleanedCombos.filter(c => {
            const key = c.combo + '||' + c.section;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });

        return {
            characterId: config.id,
            combos: dedupedCombos,
            comboTheory: scrapeResult.comboTheory ? cleanText(scrapeResult.comboTheory) : undefined,
            lastUpdated: new Date().toISOString().split('T')[0],
        };

    } catch (error: any) {
        console.error(`Failed to scrape combos for ${config.name}:`, error.message);
        try {
            if (page && !page.isClosed() && !reusedPage) await page.close();
        } catch { }
        return null;
    }
}

async function main() {
    const args = process.argv.slice(2);
    const useExistingBrowser = args.includes('--connect');
    const targetCharacter = args.find(a => !a.startsWith('--'));

    const hostIndex = args.indexOf('--host');
    const dbgHost = (hostIndex !== -1 && args[hostIndex + 1]) ? args[hostIndex + 1] : 'localhost';
    const dbgPort = '9222';
    const browserURL = `http://${dbgHost}:${dbgPort}`;

    let targets = CHARACTERS;

    if (targetCharacter) {
        const found = CHARACTERS.find(c => c.id === targetCharacter);
        if (!found) {
            console.error(`Character not found: ${targetCharacter}`);
            console.error(`Available: ${CHARACTERS.map(c => c.id).join(', ')}`);
            process.exit(1);
        }
        targets = [found];
    }

    console.log(`\n🎮 SF6 Combo Data Scraper\n`);
    console.log(`Targets: ${targets.length} character(s)\n`);

    if (useExistingBrowser) {
        console.log(`Mode: Connecting to EXISTING browser on ${browserURL}`);
    } else {
        console.log('Mode: Launching NEW browser (headless: false)');
    }

    let browser;
    try {
        if (useExistingBrowser) {
            try {
                browser = await puppeteer.connect({
                    browserURL: browserURL,
                    defaultViewport: { width: 1920, height: 1080 }
                });
            } catch (e: any) {
                console.error(`\n❌ Could not connect to browser at ${browserURL}.`);
                console.error(`Ensure Chrome is running with: --remote-debugging-port=9222`);
                process.exit(1);
            }
        } else {
            browser = await puppeteer.launch({
                headless: false,
                defaultViewport: null,
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            });
        }

        for (const config of targets) {
            const data = await scrapeCharacterCombos(browser, config);

            if (data) {
                const filePath = path.join(OUTPUT_DIR, `${data.characterId}.json`);
                fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
                console.log(`✓ Saved: ${config.name} (${data.combos.length} combos) -> ${data.characterId}.json`);
                
                // Print summary
                const sections = new Set(data.combos.map(c => c.section));
                console.log(`  Sections: ${Array.from(sections).join(', ')}`);
                console.log(`  Sample (first 3):`);
                for (const combo of data.combos.slice(0, 3)) {
                    const parts = [combo.combo];
                    if (combo.damage) parts.push(`dmg:${combo.damage}`);
                    if (combo.difficulty) parts.push(`diff:${combo.difficulty}`);
                    console.log(`    - ${parts.join(' | ')}`);
                }
            }
        }
    } finally {
        if (browser) {
            if (!useExistingBrowser) {
                await browser.close();
            } else {
                console.log(`\nDone. Detaching from browser.`);
                browser.disconnect();
            }
        }
    }
}

main().catch(console.error);
