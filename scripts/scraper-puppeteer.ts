/**
 * SF6 Frame Data Scraper (Puppeteer Version)
 * 
 * Usage:
 *   pnpm exec tsx scripts/scraper-puppeteer.ts [character] [--connect] [--host <ip>]
 * 
 *   --connect     : Connect to an existing browser (default: localhost:9222)
 *   --host <ip>   : Specify host IP (useful for WSL2 -> Windows, e.g. 192.168.x.x)
 * 
 *   Example (WSL2):
 *     pnpm exec tsx scripts/scraper-puppeteer.ts terry --connect --host 172.x.x.x
 * 
 * Uses puppeteer-extra-plugin-stealth to bypass Cloudflare protection on Supercombo Wiki.
 */

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { CHARACTERS, type CharacterConfig } from './characters';

// Add stealth plugin
puppeteer.use(StealthPlugin());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface Move {
    name: string;
    input: string;
    damage: string;
    startup: string;
    active: string;
    recovery: string;
    onBlock: string;
    onHit: string;
    category: 'normal' | 'unique' | 'special' | 'super' | 'throw';
    knockdown?: {
        type: 'soft' | 'hard' | 'none';
        advantage: number;
    };
}

interface FrameData {
    character: {
        id: string;
        name: string;
        nameJp: string;
    };
    moves: Move[];
    lastUpdated: string;
}

const OUTPUT_DIR = path.join(__dirname, '../src/data/characters');

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

function getCorrectWikiUrl(config: CharacterConfig): string {
    if (config.id === 'mai') {
        // Fallback check, usually it's documented as Mai_Shiranui if not just Mai
        // But for now we stick to config.wikiUrl or try a known variant if defined
        return config.wikiUrl;
    }
    return config.wikiUrl;
}

async function scrapeCharacter(browser: any, config: CharacterConfig): Promise<FrameData | null> {
    console.log(`Scraping ${config.name}...`);
    const targetUrl = getCorrectWikiUrl(config);

    let page;
    let reusedPage = false;

    // Check for existing pages
    const pages = await browser.pages();
    // Simple heuristic: match character name in URL AND ensure it's the wiki
    // e.g. "Terry" in "https://wiki.supercombo.gg/w/Street_Fighter_6/Terry"
    const existingPage = pages.find((p: any) => {
        const url = p.url().toLowerCase();
        return url.includes('supercombo.gg') && url.includes(config.name.toLowerCase());
    });

    if (existingPage) {
        console.log(`  🔄 Found existing tab for ${config.name}. Reusing it...`);
        page = existingPage;
        reusedPage = true;
        await page.bringToFront();
    } else {
        console.log(`  ✨ Opening new tab...`);
        page = await browser.newPage();
        await page.setViewport({ width: 1920, height: 1080 });
    }

    page.on('console', msg => console.log('PAGE LOG:', msg.text()));

    try {
        if (!reusedPage) {
            await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 60000 });

            // Human-like behavior for new pages
            await page.mouse.move(100, 100);
            await new Promise(r => setTimeout(r, 2000));
        } else {
            // If checking existing page, we assume it might be loaded or loading.
            // If the user is staring at a captcha, we wait.
        }

        try {
            console.log(`  Checking content on: ${page.url()}`);
            await page.waitForSelector('.movedata-container', { timeout: 3000 });
        } catch (e) {
            console.log('  ⚠️  No data containers found yet.');

            if (reusedPage) {
                console.log('  🔄 Reused page might be stale. Reloading...');
                await page.reload({ waitUntil: 'domcontentloaded' });
                try {
                    await page.waitForSelector('.movedata-container', { timeout: 5000 });
                } catch (retryErr) {
                    console.log('  ❌ Still no data after reload.');
                }
            } else {
                console.log('     Access might be blocked.');
            }

            // Only if we STILL don't have it, wait indefinitely
            const found = await page.$('.movedata-container');
            if (!found) {
                console.log('  🔴 ACTION REQUIRED: Please manually navigate/solve CAPTCHA in the browser window.');
                console.log('     The script is waiting indefinitely for content...');
                await page.waitForSelector('.movedata-container', { timeout: 0 });
            }
        }

        // Evaluate page to get raw data using the robust container logic
        const rawMoves = await page.evaluate(function () {
            const moves: any[] = [];
            const containers = document.querySelectorAll('.movedata-container');

            for (let i = 0; i < containers.length; i++) {
                const container = containers[i];

                // 1. Extract Name and Input
                const nameContainer = container.querySelector('.movedata-flex-framedata-name');
                if (!nameContainer) continue;

                const nameItems = nameContainer.querySelectorAll('.movedata-flex-framedata-name-item');
                let input = '';
                let name = '';

                if (nameItems.length >= 2) {
                    input = nameItems[0].textContent?.trim() || '';
                    name = nameItems[1].textContent?.trim() || '';
                } else if (nameItems.length === 1) {
                    name = nameItems[0].textContent?.trim() || '';
                    input = name;
                } else {
                    continue;
                }

                input = input.replace(/\s+/g, ' ').trim();
                name = name.replace(/\s+/g, ' ').trim();

                // 2. Extract Table Data
                const table = container.querySelector('table.wikitable');
                if (!table) continue;

                // Headers
                const headers = Array.from(table.querySelectorAll('tr:first-child th')).map(th => th.textContent?.trim().toLowerCase() || '');

                const idx = {
                    damage: headers.findIndex(h => h.includes('damage') || h.includes('dmg')),
                    startup: headers.findIndex(h => h.includes('startup')),
                    active: headers.findIndex(h => h.includes('active')),
                    recovery: headers.findIndex(h => h.includes('recovery')),
                    onBlock: headers.findIndex(h => h.includes('block')),
                    onHit: headers.findIndex(h => h.includes('hit')),
                    cancel: headers.findIndex(h => h.includes('cancel')),
                };

                // Data Row (2nd row)
                const rows = table.querySelectorAll('tr');
                if (rows.length < 2) continue;

                if (name.includes('Drive Parry')) {
                    console.log(`DEBUG: Drive Parry Headers: ${JSON.stringify(headers)}`);
                    const debugCells = Array.from(rows[1].querySelectorAll('td')).map(td => td.textContent?.trim());
                    console.log(`DEBUG: Drive Parry Cells: ${JSON.stringify(debugCells)}`);
                    console.log(`DEBUG: onBlock index: ${idx.onBlock}, onHit index: ${idx.onHit}`);
                }

                const dataRow = rows[1];
                const cells = dataRow.querySelectorAll('td');

                // 3. Extract Cancels
                const cancelText = (idx.cancel === -1 || idx.cancel >= cells.length) ? '-' : (cells[idx.cancel].textContent?.trim().replace(/\n/g, '') || '-');
                let cancels: string[] = [];
                if (cancelText && cancelText !== '-') {
                    cancels = cancelText.split(/[, ]+/).map(s => s.trim()).filter(s => s);
                }

                // 4. Knockdown Check
                const onHit = (idx.onHit === -1 || idx.onHit >= cells.length) ? '-' : (cells[idx.onHit].textContent?.trim().replace(/\n/g, '') || '-');
                const rawRowText = dataRow.textContent?.toLowerCase() || '';
                let knockdown = undefined;

                if (rawRowText.includes('kd') || rawRowText.includes('knockdown') || onHit.toLowerCase().includes('kd')) {
                    knockdown = { type: 'hard', advantage: 0 };
                }

                // Helper for repeating get logic inline
                // We use a small local closure that hopefully doesn't trigger __name, if it does we are doomed and must use string eval.
                // Reverting to manual inline for safety.

                // 5. Structure Data
                moves.push({
                    name,
                    input,
                    damage: (idx.damage === -1 || idx.damage >= cells.length) ? '-' : (cells[idx.damage].textContent?.trim().replace(/\n/g, '') || '-'),
                    startup: (idx.startup === -1 || idx.startup >= cells.length) ? '-' : (cells[idx.startup].textContent?.trim().replace(/\n/g, '') || '-'),
                    active: (idx.active === -1 || idx.active >= cells.length) ? '-' : (cells[idx.active].textContent?.trim().replace(/\n/g, '') || '-'),
                    recovery: (idx.recovery === -1 || idx.recovery >= cells.length) ? '-' : (cells[idx.recovery].textContent?.trim().replace(/\n/g, '') || '-'),
                    onBlock: (idx.onBlock === -1 || idx.onBlock >= cells.length) ? '-' : (cells[idx.onBlock].textContent?.trim().replace(/\n/g, '') || '-'),
                    onHit: onHit,
                    cancels,
                    knockdown,
                    rawMap: {
                        startup: (idx.startup === -1 || idx.startup >= cells.length) ? '-' : (cells[idx.startup].textContent?.trim().replace(/\n/g, '') || '-'),
                        active: (idx.active === -1 || idx.active >= cells.length) ? '-' : (cells[idx.active].textContent?.trim().replace(/\n/g, '') || '-'),
                        recovery: (idx.recovery === -1 || idx.recovery >= cells.length) ? '-' : (cells[idx.recovery].textContent?.trim().replace(/\n/g, '') || '-'),
                        damage: (idx.damage === -1 || idx.damage >= cells.length) ? '-' : (cells[idx.damage].textContent?.trim().replace(/\n/g, '') || '-'),
                        onBlock: (idx.onBlock === -1 || idx.onBlock >= cells.length) ? '-' : (cells[idx.onBlock].textContent?.trim().replace(/\n/g, '') || '-'),
                        onHit: onHit
                    }
                });
            }

            return moves;
        });

        // Don't close reused pages, user might need them
        if (!reusedPage) {
            await page.close();
        }

        if (!rawMoves || rawMoves.length === 0) {
            console.warn(`  Warning: No moves found for ${config.name}`);
            return null;
        }

        // Read existing file if it exists
        const filePath = path.join(OUTPUT_DIR, `${config.id}.json`);
        let existingMoves: Move[] = [];
        let existingFrameData: FrameData | null = null;

        if (fs.existsSync(filePath)) {
            try {
                const content = fs.readFileSync(filePath, 'utf-8');
                existingFrameData = JSON.parse(content);
                if (existingFrameData && Array.isArray(existingFrameData.moves)) {
                    existingMoves = existingFrameData.moves;
                    console.log(`  📂 Loaded ${existingMoves.length} existing moves for merge.`);
                }
            } catch (e) {
                console.warn(`  ⚠️ Could not read existing file: ${filePath}`);
            }
        }

        // Helper to normalize input for matching (strip spaces, lowercase)
        const normalize = (cmd: string) => cmd.toLowerCase().replace(/\s+/g, '');

        // Create a map of existing moves for fast lookup
        const existingMap = new Map<string, Move>();
        existingMoves.forEach(m => {
            if (m.input) existingMap.set(normalize(m.input), m);
        });

        const mergedMoves: Move[] = [];
        const scrapedMap = new Map<string, boolean>(); // Track what we found

        // 1. Process Scraped Moves (Merge or Add)
        rawMoves.forEach((m: any) => {
            const category = categorizeMove(m.name, m.input);
            const normalizedInput = normalize(m.input);
            scrapedMap.set(normalizedInput, true);

            // Refine knockdown
            if (m.knockdown) {
                m.knockdown.advantage = estimateKnockdownAdvantage({ ...m, category });
            }

            // Simplify Move Name
            const simpleName = simplifyMoveName(m.name);

            // Construct 'raw' object
            const parseNum = (val: string) => {
                if (!val) return null;
                // Extract first number (handling negative sign)
                const match = val.match(/-?\d+/);
                if (!match) return null;
                return parseInt(match[0], 10);
            };

            const raw = {
                moveName: simpleName, // Use simplified name
                plnCmd: m.input,
                startup: parseNum(m.rawMap.startup),
                active: parseNum(m.rawMap.active),
                recovery: parseNum(m.rawMap.recovery),
                onBlock: parseNum(m.rawMap.onBlock),
                onHit: parseNum(m.rawMap.onHit),
                dmg: parseNum(m.rawMap.damage),
            };

            const scrapedMove: Move = {
                name: simpleName, // Use simplified name
                input: m.input,
                damage: m.damage,
                startup: m.startup,
                active: m.active,
                recovery: m.recovery,
                onBlock: m.onBlock,
                onHit: m.onHit,
                category: category,
                cancels: m.cancels,
                knockdown: m.knockdown,
                raw: raw,
            };

            // MERGE LOGIC
            if (existingMap.has(normalizedInput)) {
                const existing = existingMap.get(normalizedInput)!;

                // Smart Merge:
                // 1. Deep merge 'raw' to preserve fields like 'numCmd', 'ezCmd' that we don't scrape
                // 2. Only overwrite arrays/objects if we found something useful

                const mergedRaw = {
                    ...(existing.raw || {}),
                    ...scrapedMove.raw
                };

                // Helper: Prefer new non-empty value, else keep old
                const pick = (isRaw: boolean, key: keyof Move) => {
                    const newVal = isRaw ? (scrapedMove as any)[key] : (scrapedMove as any)[key];
                    const oldVal = (existing as any)[key];
                    // If new is '-' or empty or null, keep old
                    if (newVal === '-' || newVal === '' || newVal === null || newVal === undefined) return oldVal;
                    return newVal;
                };

                const newCancels = (scrapedMove.cancels && scrapedMove.cancels.length > 0)
                    ? scrapedMove.cancels
                    : existing.cancels;

                const newKnockdown = scrapedMove.knockdown
                    ? scrapedMove.knockdown
                    : existing.knockdown;

                mergedMoves.push({
                    ...existing, // Base: keep all existing fields (inc notes, custom props)

                    // Specific Updates
                    name: scrapedMove.name, // Name from wiki is usually canonical

                    // Frame Data: Only update if scraper found a real value
                    damage: pick(false, 'damage'),
                    startup: pick(false, 'startup'),
                    active: pick(false, 'active'),
                    recovery: pick(false, 'recovery'),
                    onBlock: pick(false, 'onBlock'),
                    onHit: pick(false, 'onHit'),

                    cancels: newCancels,
                    knockdown: newKnockdown,
                    raw: mergedRaw
                });
            } else {
                // New move found on wiki
                mergedMoves.push(scrapedMove);
            }
        });

        // 2. Preserve Existing Moves NOT found in Scraper?
        // If a move exists in the file but wasn't scraped (maybe scraper missed it, or it's a manual custom move), we should keep it.
        existingMoves.forEach(existing => {
            if (existing.input && !scrapedMap.has(normalize(existing.input))) {
                mergedMoves.push(existing);
            }
        });

        // Filter and Sort
        const validMoves = mergedMoves.filter(m => m.name && m.input);

        // Sort: Normal -> Unique -> Throw -> Special -> Super
        const categoryOrder = { 'normal': 1, 'unique': 2, 'throw': 3, 'special': 4, 'super': 5 };
        validMoves.sort((a, b) => (categoryOrder[a.category] || 99) - (categoryOrder[b.category] || 99));

        return {
            character: { id: config.id, name: config.name, nameJp: config.nameJp },
            moves: validMoves,
            lastUpdated: new Date().toISOString().split('T')[0],
        };

    } catch (error: any) {
        console.error(`Failed to scrape ${config.name}:`, error.message);
        try {
            if (page && !page.isClosed() && !reusedPage) await page.close();
        } catch { }
        return null;
    }
}

function categorizeMove(name: string, input: string): Move['category'] {
    const lowerName = name.toLowerCase();
    const lowerInput = input.toLowerCase();

    if (lowerName.includes('throw') || lowerInput.includes('lp+lk')) return 'throw';
    if (lowerInput.includes('sa') || lowerName.includes('super')) return 'super';
    if (lowerInput.includes('qcf') || lowerInput.includes('qcb') || lowerInput.includes('dp') || lowerInput.includes('hcf') || lowerInput.includes('236') || lowerInput.includes('214') || lowerInput.includes('623')) return 'special';
    // Heuristic: inputs with + that aren't throw are usually command normals
    if ((lowerInput.includes('+') || lowerInput.match(/[46][a-z]/)) && !lowerInput.includes('lp+lk')) return 'unique';
    return 'normal';
}

function estimateKnockdownAdvantage(move: any): number {
    if (move.category === 'super') return 40;
    if (move.category === 'special') return 25;
    return 20;
}

async function main() {
    const args = process.argv.slice(2);
    const useExistingBrowser = args.includes('--connect');
    const targetCharacter = args.find(a => !a.startsWith('--'));

    // Parse host arg: --host 127.0.0.1
    const hostIndex = args.indexOf('--host');
    const dbgHost = (hostIndex !== -1 && args[hostIndex + 1]) ? args[hostIndex + 1] : 'localhost';
    const dbgPort = '9222';
    const browserURL = `http://${dbgHost}:${dbgPort}`;

    let targets = CHARACTERS;

    if (targetCharacter) {
        const found = CHARACTERS.find(c => c.id === targetCharacter);
        if (!found) {
            console.error(`Character not found: ${targetCharacter}`);
            process.exit(1);
        }
        targets = [found];
    }

    console.log(`\n🎮 SF6 Frame Data Scraper (Puppeteer)\n`);
    console.log(`Targets: ${targets.length} character(s)\n`);

    if (useExistingBrowser) {
        console.log(`Mode: Connecting to EXISTING browser on ${browserURL}`);
        console.log('Ensure you launched Chrome with: --remote-debugging-port=9222');
        if (dbgHost !== 'localhost') {
            console.log('Note: Ensure Windows Firewall allows incoming connections on port 9222.');
        }
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
                console.error(`\nTroubleshooting for WSL2 -> Windows:`);
                console.error(`1. Check your Windows IP (in PowerShell: ipconfig)`);
                console.error(`2. Run in WSL: pnpm exec tsx scripts/scraper-puppeteer.ts terry --connect --host <WINDOWS_IP>`);
                console.error(`3. Ensure Windows Firewall allows chrome.exe on Private/Public networks.`);
                console.error(`4. Ensure Chrome was started with --remote-debugging-port=9222 --user-data-dir="C:/ChromeDevSession"`);
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
            const data = await scrapeCharacter(browser, config);

            if (data) {
                const filePath = path.join(OUTPUT_DIR, `${data.character.id}.json`);
                fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
                console.log(`✓ Saved: ${config.name} (${data.moves.length} moves) -> ${data.character.id}.json`);
            }
        }
    } finally {
        if (browser) {
            if (!useExistingBrowser) {
                await browser.close();
                console.log(`\nBrowser closed.`);
            } else {
                console.log(`\nDone. Detaching from existing browser (it stays open).`);
                browser.disconnect();
            }
        }
    }
}

function simplifyMoveName(name: string): string {
    return name
        .replace(/Standing/g, 'Stand')
        .replace(/Crouching/g, 'Crouch')
        .replace(/Jumping/g, 'Jump')
        .replace(/Light Punch/g, 'LP')
        .replace(/Medium Punch/g, 'MP')
        .replace(/Heavy Punch/g, 'HP')
        .replace(/Light Kick/g, 'LK')
        .replace(/Medium Kick/g, 'MK')
        .replace(/Heavy Kick/g, 'HK')
        .trim();
}

main().catch(console.error);
