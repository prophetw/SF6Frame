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

type MoveCategory = 'normal' | 'unique' | 'special' | 'super' | 'throw';

interface KnockdownData {
    type: 'soft' | 'hard' | 'none';
    advantage: number;
}

interface Move {
    name: string;
    nameZh?: string;
    input: string;
    damage: string;
    startup: string;
    active: string;
    recovery: string;
    onBlock: string;
    onHit: string;
    category: MoveCategory;
    cancels?: string[];
    knockdown?: KnockdownData;
    noMeaty?: boolean;
    notes?: string;
    raw?: any;
}

interface CharacterStats {
    health: number;
    forwardDash: number;
    backDash: number;
    forwardWalk?: number;
    backWalk?: number;
}

interface FrameData {
    character: {
        id: string;
        name: string;
        nameJp: string;
    };
    stats: CharacterStats;
    moves: Move[];
    lastUpdated: string;
}

interface ScrapedMove {
    name: string;
    input: string;
    damage: string;
    startup: string;
    active: string;
    recovery: string;
    onBlock: string;
    onHit: string;
    cancelText?: string;
    section?: string;
    variant?: string;
}

interface ScrapedStats {
    health?: string;
    forwardDash?: string;
    backDash?: string;
    forwardWalk?: string;
    backWalk?: string;
}

const OUTPUT_DIR = path.join(__dirname, '../src/data/characters');

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

function normalizeWhitespace(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
}

function stripFootnotes(value: string): string {
    return value.replace(/\[[^\]]+\]/g, '').trim();
}

function normalizeFrameText(value: string | undefined | null): string {
    if (value === undefined || value === null) return '-';
    let text = normalizeWhitespace(String(value));
    text = stripFootnotes(text);
    text = text.replace(/[−–—]/g, '-').replace(/[＋]/g, '+');
    if (!text || text.toLowerCase() === 'n/a' || text === '—' || text === '--') return '-';
    return text;
}

function extractNumber(value: string): number | null {
    const match = value.match(/-?\d+/);
    if (!match) return null;
    return parseInt(match[0], 10);
}

function parseStatNumber(value?: string): number | null {
    if (!value) return null;
    const match = value.match(/-?\d+/);
    return match ? parseInt(match[0], 10) : null;
}

function parseStatFloat(value?: string): number | null {
    if (!value) return null;
    const match = value.match(/-?\d+(\.\d+)?/);
    return match ? parseFloat(match[0]) : null;
}

function parseFrameNumber(value: string): number | null {
    const cleaned = normalizeFrameText(value);
    if (cleaned === '-') return null;
    if (/[a-z]/i.test(cleaned)) return null;
    const match = cleaned.match(/-?\d+/);
    return match ? parseInt(match[0], 10) : null;
}

function evaluateFrameString(value: string | undefined | null): number | null {
    const cleaned = normalizeFrameText(value);
    if (!cleaned || cleaned === '-') return null;
    const normalized = cleaned.replace(/x/gi, '*');
    if (normalized.includes('*')) {
        let sum = 0;
        let found = false;
        for (const part of normalized.split('*')) {
            const num = parseInt(part, 10);
            if (!isNaN(num)) {
                sum += num;
                found = true;
            }
        }
        return found ? sum : null;
    }
    const match = normalized.match(/-?\d+/);
    return match ? parseInt(match[0], 10) : null;
}

function parseRecoveryFrames(value: string | undefined | null): number | null {
    if (!value) return null;
    const whiffMatch = String(value).match(/\((\d+)\)/);
    if (whiffMatch) return parseInt(whiffMatch[1], 10);
    return evaluateFrameString(value);
}

function parseHitRecoveryFrames(value: string | undefined | null): number | null {
    if (!value) return null;
    const cleaned = normalizeFrameText(value);
    if (!cleaned || cleaned === '-') return null;
    // "13(15)" -> "13" (hit/contact recovery)
    const main = cleaned.split('(')[0];
    return evaluateFrameString(main);
}

function normalizeOnHitValue(value: string): string {
    const cleaned = normalizeFrameText(value);
    if (cleaned === '-') return cleaned;
    const upper = cleaned.toUpperCase();
    const hasKD = /(HKD|KD|KNOCKDOWN|CRUMPLE)/.test(upper);
    if (!hasKD) return cleaned;
    if (/^\s*(HKD|KD|KNOCKDOWN|CRUMPLE)\b/i.test(cleaned)) return cleaned;
    const num = extractNumber(cleaned);
    const label = /(HKD|HARD KNOCKDOWN)/.test(upper) ? 'HKD' : 'KD';
    if (num === null) return label;
    return `${label} +${Math.abs(num)}`;
}

function normalizeInput(value: string): string {
    return normalizeFrameText(value);
}

function normalizeMoveName(value: string): string {
    return simplifyMoveName(normalizeFrameText(value));
}

function normalizeVariantLabel(value?: string): string {
    if (!value) return '';
    return normalizeFrameText(value);
}

function applyVariantToInput(baseInput: string, variant: string): string {
    if (!variant) return baseInput;
    const base = normalizeFrameText(baseInput);
    const label = normalizeFrameText(variant);
    if (!label || label === '-') return base;

    const upperLabel = label.toUpperCase();
    const upperBase = base.toUpperCase();
    const strengthSuffix = upperBase.match(/(LP|MP|HP|LK|MK|HK|PP|KK)$/);

    // If variant itself looks like a full input, use it
    if (/[0-9]/.test(label) && /[PK]/i.test(label)) {
        return label;
    }

    const isOD = upperLabel === 'OD' || upperLabel === 'EX';
    if (isOD) {
        if (strengthSuffix) {
            if (strengthSuffix[1].includes('P')) {
                return base.replace(/(LP|MP|HP|PP)$/i, 'PP');
            }
            if (strengthSuffix[1].includes('K')) {
                return base.replace(/(LK|MK|HK|KK)$/i, 'KK');
            }
        }
        if (upperBase.includes('P')) return base.replace(/P(?!.*P)/i, 'PP');
        if (upperBase.includes('K')) return base.replace(/K(?!.*K)/i, 'KK');
        return `${base} OD`;
    }

    // Strength labels like LP/MP/HP/LK/MK/HK/PP/KK
    if (/[LMH][PK]/i.test(upperLabel) || upperLabel === 'PP' || upperLabel === 'KK') {
        if (strengthSuffix) {
            return base.replace(/(LP|MP|HP|LK|MK|HK|PP|KK)$/i, label);
        }
        if (upperBase.match(/P(?!.*P)/i)) {
            return base.replace(/P(?!.*P)/i, label);
        }
        if (upperBase.match(/K(?!.*K)/i)) {
            return base.replace(/K(?!.*K)/i, label);
        }
        return `${base}${label}`;
    }

    return `${base} ${label}`;
}

function applyVariantToName(baseName: string, variant: string): string {
    if (!variant) return baseName;
    const label = normalizeFrameText(variant);
    if (!label || label === '-') return baseName;
    const lowerName = baseName.toLowerCase();
    if (lowerName.includes(label.toLowerCase())) return baseName;
    return `${baseName} (${label})`;
}

function parseKnockdown(onHit: string, category: MoveCategory): KnockdownData | undefined {
    const cleaned = normalizeFrameText(onHit);
    if (!cleaned || cleaned === '-') return undefined;
    const upper = cleaned.toUpperCase();
    if (/(HKD|KD|KNOCKDOWN|CRUMPLE)/.test(upper)) {
        const num = extractNumber(cleaned);
        const type: KnockdownData['type'] = /(HKD|HARD KNOCKDOWN)/.test(upper) ? 'hard' : 'soft';
        const advantage = num !== null ? Math.abs(num) : estimateKnockdownAdvantage({ category });
        return { type, advantage };
    }
    return undefined;
}

function normalizeCancelTags(cancelText?: string): string[] | undefined {
    if (!cancelText) return undefined;
    const cleaned = normalizeFrameText(cancelText);
    if (!cleaned || cleaned === '-' || cleaned.toLowerCase() === 'none') return undefined;

    const tokens = cleaned
        .replace(/[|/]/g, ' ')
        .replace(/,/g, ' ')
        .split(/\s+/)
        .map(t => t.trim())
        .filter(Boolean);

    const result: string[] = [];
    const seen = new Set<string>();

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        const upper = token.toUpperCase();
        const next = tokens[i + 1]?.toUpperCase();
        let mapped: string | null = null;

        if (upper === 'TARGET' && next === 'COMBO') {
            mapped = 'Target Combo';
            i++;
        } else if (upper === 'SP' || upper === 'SPECIAL') mapped = 'Special';
        else if (upper === 'SU' || upper === 'SUPER' || upper === 'SA') mapped = 'Super';
        else if (upper === 'SA1' || upper === 'SA2' || upper === 'SA3') mapped = upper;
        else if (upper === 'CA') mapped = 'CA';
        else if (upper === 'CH' || upper === 'CHN' || upper === 'CHAIN') mapped = 'Chain';
        else if (upper === 'TC' || upper === 'TARGET' || upper === 'TARGETCOMBO' || upper === 'TARGET-COMBO') mapped = 'Target Combo';
        else mapped = token;

        if (mapped && !seen.has(mapped)) {
            seen.add(mapped);
            result.push(mapped);
        }
    }

    return result.length > 0 ? result : undefined;
}

function deriveSuperCmnName(name: string): string | undefined {
    const upper = name.toUpperCase();
    if (upper.includes('SA1') || upper.includes('SUPER ART 1') || upper.includes('LEVEL 1')) return 'Level 1';
    if (upper.includes('SA2') || upper.includes('SUPER ART 2') || upper.includes('LEVEL 2')) return 'Level 2';
    if (upper.includes('SA3') || upper.includes('SUPER ART 3') || upper.includes('LEVEL 3')) return 'Level 3';
    if (upper.includes('CRITICAL ART')) return 'Critical Art';
    return undefined;
}

function deriveMoveType(category: MoveCategory, name: string, input: string, section?: string): string {
    const lowerName = name.toLowerCase();
    const lowerInput = input.toLowerCase();
    const lowerSection = section?.toLowerCase() || '';

    if (lowerSection.includes('drive') || lowerName.includes('drive') || lowerInput.includes('mp+mk') || lowerInput.includes('di')) {
        return 'drive';
    }
    if (category === 'throw') return 'throw';
    if (category === 'super') return 'super';
    if (category === 'special') return 'special';
    if (category === 'unique') return 'unique';
    return 'normal';
}

function computeRawTotals(startupText: string, activeText: string, recoveryText: string) {
    const startup = extractNumber(startupText);
    const active = evaluateFrameString(activeText);
    const recovery = parseRecoveryFrames(recoveryText);

    if (startup === null || active === null || recovery === null) return undefined;
    const startupFrames = Math.max(0, startup - 1);
    return startupFrames + active + recovery;
}

function buildRawMove(move: Move, section?: string) {
    const startup = parseFrameNumber(move.startup);
    const active = evaluateFrameString(move.active);
    const recovery = parseRecoveryFrames(move.recovery);
    const hitRecovery = parseHitRecoveryFrames(move.recovery);
    const onBlock = parseFrameNumber(move.onBlock);
    const onHit = parseFrameNumber(move.onHit);
    const damage = parseFrameNumber(move.damage);

    const total = computeRawTotals(move.startup, move.active, move.recovery);

    const raw: any = {
        source: 'supercombo',
        moveName: move.name,
        plnCmd: move.input,
        startup,
        active,
        recovery,
        onBlock,
        onHit,
        dmg: damage,
        total,
        moveType: deriveMoveType(move.category, move.name, move.input, section),
        cmnName: deriveSuperCmnName(move.name),
        section
    };

    if (active !== null && hitRecovery !== null && onBlock !== null) {
        raw.blockstun = active + hitRecovery + onBlock;
    }
    if (active !== null && hitRecovery !== null && onHit !== null) {
        raw.hitstun = active + hitRecovery + onHit;
    }

    return raw;
}

function normalizeStats(scraped: ScrapedStats | null, fallback?: CharacterStats): CharacterStats {
    const health = parseStatNumber(scraped?.health) ?? fallback?.health ?? 10000;
    const forwardDash = parseStatNumber(scraped?.forwardDash) ?? fallback?.forwardDash ?? 0;
    const backDash = parseStatNumber(scraped?.backDash) ?? fallback?.backDash ?? 0;
    const forwardWalk = parseStatFloat(scraped?.forwardWalk) ?? fallback?.forwardWalk;
    const backWalk = parseStatFloat(scraped?.backWalk) ?? fallback?.backWalk;

    return { health, forwardDash, backDash, forwardWalk, backWalk };
}

function loadExistingStats(filePath: string): CharacterStats | undefined {
    if (!fs.existsSync(filePath)) return undefined;
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(content);
        if (parsed && parsed.stats) {
            return parsed.stats as CharacterStats;
        }
    } catch {
        return undefined;
    }
    return undefined;
}

function loadExistingMoveExtras(filePath: string): Map<string, { nameZh?: string; noMeaty?: boolean }> {
    const extras = new Map<string, { nameZh?: string; noMeaty?: boolean }>();
    if (!fs.existsSync(filePath)) return extras;
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(content);
        const moves = Array.isArray(parsed?.moves) ? parsed.moves : [];
        for (const move of moves) {
            if (!move || !move.name || !move.input) continue;
            if (move.nameZh === undefined && move.noMeaty === undefined) continue;
            const key = `${move.name}||${move.input}`;
            extras.set(key, { nameZh: move.nameZh, noMeaty: move.noMeaty });
        }
    } catch {
        return extras;
    }
    return extras;
}

function normalizeScrapedMove(scraped: ScrapedMove): Move {
    const rawName = normalizeFrameText(scraped.name);
    const variant = normalizeVariantLabel(scraped.variant);
    const baseInput = normalizeInput(scraped.input);
    const input = applyVariantToInput(baseInput, variant);
    const baseName = normalizeMoveName(rawName);
    const name = applyVariantToName(baseName, variant);

    const damage = normalizeFrameText(scraped.damage);
    const startup = normalizeFrameText(scraped.startup);
    const active = normalizeFrameText(scraped.active);
    const recovery = normalizeFrameText(scraped.recovery);
    const onBlock = normalizeFrameText(scraped.onBlock);
    const onHit = normalizeOnHitValue(scraped.onHit);

    const category = categorizeMove(name, input, scraped.section);
    const cancels = normalizeCancelTags(scraped.cancelText);
    const knockdown = parseKnockdown(onHit, category);

    if ((category === 'normal' || category === 'unique') && cancels && cancels.length > 0) {
        if (!cancels.includes('Drive Rush')) {
            cancels.push('Drive Rush');
        }
    }

    const move: Move = {
        name,
        input,
        damage,
        startup,
        active,
        recovery,
        onBlock,
        onHit,
        category,
        cancels,
        knockdown
    };

    const raw = buildRawMove(move, scraped.section);
    raw.sourceName = rawName;
    raw.sourceInput = input;
    raw.cancelText = scraped.cancelText;
    move.raw = raw;

    return move;
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
        const scrapeScript = `
(() => {
  const moves = [];
  const containers = document.querySelectorAll('.movedata-container');

  function findSectionTitle(node) {
    let current = node;
    while (current) {
      let prev = current.previousElementSibling;
      while (prev) {
        const tag = prev.tagName.toLowerCase();
        if (tag === 'h2' || tag === 'h3' || tag === 'h4' || tag === 'h5') {
          return (prev.textContent || '').trim();
        }
        prev = prev.previousElementSibling;
      }
      current = current.parentElement;
    }
    return '';
  }

  for (let i = 0; i < containers.length; i++) {
    const container = containers[i];
    const section = findSectionTitle(container);
    const nameContainers = Array.from(container.querySelectorAll('.movedata-flex-framedata-name'));

    const parseMoveBlock = (input, name, table) => {
      if (!input || !name || !table) return;

      input = input.replace(/\\s+/g, ' ').trim();
      name = name.replace(/\\s+/g, ' ').trim();

      const headers = Array.from(table.querySelectorAll('tr:first-child th')).map(th => (th.textContent || '').trim().toLowerCase());

      const idx = {
        damage: headers.findIndex(h => h.includes('damage') || h.includes('dmg')),
        startup: headers.findIndex(h => h.includes('startup')),
        active: headers.findIndex(h => h.includes('active')),
        recovery: headers.findIndex(h => h.includes('recovery')),
        onBlock: headers.findIndex(h => h.includes('on block') || (h.includes('block') && !h.includes('guard'))),
        onHit: headers.findIndex(h => h.includes('on hit') || h.includes('hit')),
        cancel: headers.findIndex(h => h.includes('cancel')),
        variant: headers.findIndex(h =>
          h.includes('input') ||
          h.includes('button') ||
          h.includes('version') ||
          h.includes('strength') ||
          h === 'move'
        ),
      };

      const dataIndices = [idx.damage, idx.startup, idx.active, idx.recovery, idx.onBlock, idx.onHit].filter(i => i >= 0);
      const minDataIndex = dataIndices.length ? Math.min.apply(null, dataIndices) : -1;
      if (idx.variant === -1 && minDataIndex > 0) {
        idx.variant = 0;
      }

      const rows = table.querySelectorAll('tr');
      if (rows.length < 2) return;

      for (let r = 1; r < rows.length; r++) {
        const dataRow = rows[r];
        const cells = dataRow.querySelectorAll('td');
        if (cells.length === 0) continue;

        function getCell(index) {
          if (index === -1 || index >= cells.length) return '-';
          return ((cells[index].textContent || '').trim()).replace(/\\n/g, '') || '-';
        }

        let variant = idx.variant !== -1 ? getCell(idx.variant) : '';
        if (!variant || variant === '-') {
          const firstCell = getCell(0);
          if (/^(LP|MP|HP|LK|MK|HK|PP|KK|OD|EX|L|M|H)$/i.test(firstCell)) {
            variant = firstCell;
          }
        }

        moves.push({
          name,
          input,
          damage: getCell(idx.damage),
          startup: getCell(idx.startup),
          active: getCell(idx.active),
          recovery: getCell(idx.recovery),
          onBlock: getCell(idx.onBlock),
          onHit: getCell(idx.onHit),
          cancelText: getCell(idx.cancel),
          section,
          variant
        });
      }
    };

    if (nameContainers.length > 0) {
      for (const nameContainer of nameContainers) {
        const nameItems = nameContainer.querySelectorAll('.movedata-flex-framedata-name-item');
        let input = '';
        let name = '';

        if (nameItems.length >= 2) {
          input = (nameItems[0].textContent || '').trim();
          name = (nameItems[1].textContent || '').trim();
        } else if (nameItems.length === 1) {
          name = (nameItems[0].textContent || '').trim();
          input = name;
        }

        let table = null;
        let node = nameContainer;
        while (node && !table) {
          node = node.nextElementSibling;
          if (!node) break;
          if (node.matches && node.matches('table.wikitable')) table = node;
          else {
            const nested = node.querySelector && node.querySelector('table.wikitable');
            if (nested) table = nested;
          }
        }

        parseMoveBlock(input, name, table);
      }
    } else {
      // Fallback: try to parse heading above container
      let heading = '';
      let prev = container.previousElementSibling;
      while (prev) {
        const tag = prev.tagName.toLowerCase();
        if (tag === 'h5' || tag === 'h4' || tag === 'h3' || tag === 'h2') {
          heading = (prev.textContent || '').trim();
          break;
        }
        prev = prev.previousElementSibling;
      }

      let input = '';
      let name = '';
      if (heading) {
        const parts = heading.split(/[:\\-–—]/).map(p => p.trim()).filter(Boolean);
        if (parts.length >= 2) {
          input = parts[0];
          name = parts.slice(1).join(' ');
        } else {
          name = heading;
          input = heading;
        }
      }

      const table = container.querySelector('table.wikitable');
      parseMoveBlock(input, name, table);
    }
  }

  function extractStats() {
    const tables = Array.from(document.querySelectorAll('table.wikitable'));
    for (const table of tables) {
      const headerCells = Array.from(table.querySelectorAll('tr:first-child th'));
      const headers = headerCells.map(th => (th.textContent || '').trim().toLowerCase());
      const dataRow = table.querySelector('tr:nth-child(2)');
      if (headers.length > 0 && dataRow) {
        const values = Array.from(dataRow.querySelectorAll('td')).map(td => (td.textContent || '').trim());
        const healthIdx = headers.findIndex(h => h.includes('health'));
        const fDashIdx = headers.findIndex(h => h.includes('forward') && h.includes('dash'));
        const bDashIdx = headers.findIndex(h => h.includes('back') && h.includes('dash'));
        const fWalkIdx = headers.findIndex(h => h.includes('forward') && h.includes('walk'));
        const bWalkIdx = headers.findIndex(h => h.includes('back') && h.includes('walk'));
        if (healthIdx !== -1 || fDashIdx !== -1 || bDashIdx !== -1) {
          return {
            health: values[healthIdx] || '',
            forwardDash: values[fDashIdx] || '',
            backDash: values[bDashIdx] || '',
            forwardWalk: values[fWalkIdx] || '',
            backWalk: values[bWalkIdx] || ''
          };
        }
      }

      const rows = Array.from(table.querySelectorAll('tr'));
      const stats = {};
      for (const row of rows) {
        const cells = row.querySelectorAll('th, td');
        if (cells.length < 2) continue;
        const label = ((cells[0].textContent || '').trim()).toLowerCase();
        const value = (cells[1].textContent || '').trim();
        if (label.includes('health')) stats.health = value;
        if (label.includes('forward') && label.includes('dash')) stats.forwardDash = value;
        if (label.includes('back') && label.includes('dash')) stats.backDash = value;
        if (label.includes('forward') && label.includes('walk')) stats.forwardWalk = value;
        if (label.includes('back') && label.includes('walk')) stats.backWalk = value;
      }
      if (Object.keys(stats).length > 0) return stats;
    }
    return null;
  }

  return { moves, stats: extractStats() };
})()
        `;
        const scrapeResult = await page.evaluate(scrapeScript);

        // Don't close reused pages, user might need them
        if (!reusedPage) {
            await page.close();
        }

        if (!scrapeResult || !scrapeResult.moves || scrapeResult.moves.length === 0) {
            console.warn(`  Warning: No moves found for ${config.name}`);
            return null;
        }
        // Read existing stats (fallback only)
        const filePath = path.join(OUTPUT_DIR, `${config.id}.json`);
        const existingStats = loadExistingStats(filePath);
        const existingMoveExtras = loadExistingMoveExtras(filePath);
        const stats = normalizeStats(scrapeResult.stats || null, existingStats);
        if (!scrapeResult.stats) {
            if (existingStats) {
                console.log('  ℹ️ Using existing stats as fallback.');
            } else {
                console.log('  ⚠️ No stats found on page; using defaults.');
            }
        }

        const normalizedMoves: Move[] = [];
        const seen = new Set<string>();

        for (const rawMove of scrapeResult.moves) {
            const move = normalizeScrapedMove(rawMove as ScrapedMove);
            if (!move.name || !move.input) continue;
            const key = `${move.name}||${move.input}`;
            if (seen.has(key)) continue;
            seen.add(key);
            normalizedMoves.push(move);
        }

        // Filter and Sort
        const validMoves = normalizedMoves.filter(m => m.name && m.input);

        if (existingMoveExtras.size > 0) {
            for (const move of validMoves) {
                const key = `${move.name}||${move.input}`;
                const extras = existingMoveExtras.get(key);
                if (!extras) continue;
                if (extras.nameZh !== undefined) move.nameZh = extras.nameZh;
                if (extras.noMeaty !== undefined) move.noMeaty = extras.noMeaty;
            }
        }

        // Sort: Normal -> Unique -> Throw -> Special -> Super
        const categoryOrder = { normal: 1, unique: 2, throw: 3, special: 4, super: 5 };
        validMoves.sort((a, b) => (categoryOrder[a.category] || 99) - (categoryOrder[b.category] || 99));

        return {
            character: { id: config.id, name: config.name, nameJp: config.nameJp },
            stats,
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

function categorizeMove(name: string, input: string, section?: string): MoveCategory {
    const lowerName = name.toLowerCase();
    const lowerInput = input.toLowerCase();
    const lowerSection = section?.toLowerCase() || '';

    if (lowerSection.includes('throw')) return 'throw';
    if (lowerSection.includes('super')) return 'super';
    if (lowerSection.includes('special')) return 'special';
    if (lowerSection.includes('unique') || lowerSection.includes('command')) return 'unique';
    if (lowerSection.includes('normal')) return 'normal';
    if (lowerSection.includes('drive')) return 'special';

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
