/**
 * SF6 Frame Data Scraper
 * 
 * Usage:
 *   pnpm tsx scripts/scraper.ts          # Scrape all characters
 *   pnpm tsx scripts/scraper.ts ryu      # Scrape specific character
 *   pnpm tsx scripts/scraper.ts --demo   # Generate demo data
 * 
 * Note: Supercombo Wiki may block automated requests. 
 * If scraping fails, use --demo to generate sample data for testing.
 */

import axios from 'axios';
import * as cheerio from 'cheerio';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { CHARACTERS, type CharacterConfig } from './characters';

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

async function scrapeCharacter(config: CharacterConfig): Promise<FrameData | null> {
    console.log(`Scraping ${config.name}...`);

    try {
        const response = await axios.get(config.wikiUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            },
            timeout: 10000,
        });

        const $ = cheerio.load(response.data);
        const moves: Move[] = [];

        // Parse frame data tables
        // Supercombo Wiki typically has tables with class 'wikitable'
        $('table.wikitable').each((_, table) => {
            const $table = $(table);
            const headers: string[] = [];

            // Get headers
            $table.find('tr:first-child th').each((_, th) => {
                headers.push($(th).text().trim().toLowerCase());
            });

            // Check if this is a frame data table
            const hasFrameData = headers.some(h =>
                h.includes('startup') || h.includes('active') || h.includes('recovery')
            );

            if (!hasFrameData) return;

            // Parse rows
            $table.find('tr').slice(1).each((_, row) => {
                const $row = $(row);
                const cells: string[] = [];

                $row.find('td').each((_, td) => {
                    cells.push($(td).text().trim());
                });

                if (cells.length < 4) return;

                // Map cells to move data (adjust indices based on wiki structure)
                const move: Move = {
                    name: cells[0] || 'Unknown',
                    input: cells[1] || '',
                    damage: cells[2] || '-',
                    startup: cells[3] || '-',
                    active: cells[4] || '-',
                    recovery: cells[5] || '-',
                    onBlock: cells[6] || '-',
                    onHit: cells[7] || '-',
                    category: categorizeMove(cells[0], cells[1]),
                };

                // Check for knockdown
                if (cells.some(c => c.toLowerCase().includes('kd') || c.toLowerCase().includes('knockdown'))) {
                    move.knockdown = {
                        type: 'hard',
                        advantage: estimateKnockdownAdvantage(move),
                    };
                }

                moves.push(move);
            });
        });

        return {
            character: {
                id: config.id,
                name: config.name,
                nameJp: config.nameJp,
            },
            moves,
            lastUpdated: new Date().toISOString().split('T')[0],
        };

    } catch (error: any) {
        console.error(`Failed to scrape ${config.name}:`, error.message);
        return null;
    }
}

function categorizeMove(name: string, input: string): Move['category'] {
    const lowerName = name.toLowerCase();
    const lowerInput = input.toLowerCase();

    if (lowerName.includes('throw') || lowerInput.includes('lp+lk')) {
        return 'throw';
    }
    if (lowerInput.includes('sa') || lowerName.includes('super')) {
        return 'super';
    }
    if (lowerInput.includes('qcf') || lowerInput.includes('qcb') ||
        lowerInput.includes('dp') || lowerInput.includes('hcf')) {
        return 'special';
    }
    if (lowerInput.includes('+') && !lowerInput.includes('lp+lk')) {
        return 'unique';
    }
    return 'normal';
}

function estimateKnockdownAdvantage(move: Move): number {
    // Rough estimates based on common SF6 values
    const startup = parseInt(move.startup) || 10;
    if (move.category === 'super') return 40;
    if (move.category === 'special') return 25;
    return 20;
}

// Generate demo data for testing
function generateDemoData(config: CharacterConfig): FrameData {
    const normals: Move[] = [
        { name: 'Standing LP', input: '5LP', damage: '300', startup: '4', active: '2', recovery: '6', onBlock: '+2', onHit: '+5', category: 'normal' },
        { name: 'Standing MP', input: '5MP', damage: '600', startup: '6', active: '3', recovery: '12', onBlock: '+1', onHit: '+5', category: 'normal' },
        { name: 'Standing HP', input: '5HP', damage: '800', startup: '9', active: '3', recovery: '18', onBlock: '-4', onHit: '+2', category: 'normal' },
        { name: 'Standing LK', input: '5LK', damage: '300', startup: '5', active: '2', recovery: '9', onBlock: '+1', onHit: '+4', category: 'normal' },
        { name: 'Standing MK', input: '5MK', damage: '600', startup: '8', active: '3', recovery: '14', onBlock: '-2', onHit: '+3', category: 'normal' },
        { name: 'Standing HK', input: '5HK', damage: '900', startup: '11', active: '4', recovery: '20', onBlock: '-6', onHit: 'KD', category: 'normal', knockdown: { type: 'hard', advantage: 28 } },
        { name: 'Crouching LP', input: '2LP', damage: '300', startup: '4', active: '2', recovery: '7', onBlock: '+2', onHit: '+5', category: 'normal' },
        { name: 'Crouching MP', input: '2MP', damage: '600', startup: '6', active: '3', recovery: '10', onBlock: '+2', onHit: '+6', category: 'normal' },
        { name: 'Crouching HP', input: '2HP', damage: '800', startup: '8', active: '4', recovery: '18', onBlock: '-7', onHit: '+1', category: 'normal' },
        { name: 'Crouching LK', input: '2LK', damage: '300', startup: '4', active: '2', recovery: '9', onBlock: '+1', onHit: '+4', category: 'normal' },
        { name: 'Crouching MK', input: '2MK', damage: '500', startup: '7', active: '3', recovery: '15', onBlock: '-3', onHit: '+2', category: 'normal' },
        { name: 'Crouching HK', input: '2HK', damage: '900', startup: '10', active: '3', recovery: '26', onBlock: '-13', onHit: 'KD', category: 'normal', knockdown: { type: 'hard', advantage: 45 } },
    ];

    const uniqueMoves: Move[] = [
        { name: 'Collarbone Breaker', input: '6MP', damage: '700', startup: '19', active: '4', recovery: '16', onBlock: '-2', onHit: '+4', category: 'unique' },
        { name: 'Solar Plexus Strike', input: '6HP', damage: '900', startup: '16', active: '3', recovery: '20', onBlock: '-4', onHit: '+3', category: 'unique' },
    ];

    const specials: Move[] = [
        { name: 'Hadoken (L)', input: '236LP', damage: '600', startup: '13', active: '-', recovery: '44', onBlock: '-6', onHit: '+1', category: 'special' },
        { name: 'Hadoken (M)', input: '236MP', damage: '700', startup: '14', active: '-', recovery: '45', onBlock: '-6', onHit: '+1', category: 'special' },
        { name: 'Hadoken (H)', input: '236HP', damage: '800', startup: '15', active: '-', recovery: '46', onBlock: '-6', onHit: '+1', category: 'special' },
        { name: 'Shoryuken (L)', input: '623LP', damage: '1000', startup: '4', active: '13', recovery: '27', onBlock: '-26', onHit: 'KD', category: 'special', knockdown: { type: 'hard', advantage: 22 } },
        { name: 'Shoryuken (M)', input: '623MP', damage: '1200', startup: '5', active: '17', recovery: '31', onBlock: '-34', onHit: 'KD', category: 'special', knockdown: { type: 'hard', advantage: 24 } },
        { name: 'Shoryuken (H)', input: '623HP', damage: '1400', startup: '6', active: '20', recovery: '35', onBlock: '-38', onHit: 'KD', category: 'special', knockdown: { type: 'hard', advantage: 26 } },
        { name: 'Tatsumaki (L)', input: '214LK', damage: '700', startup: '11', active: '2x3', recovery: '18', onBlock: '-6', onHit: '+2', category: 'special' },
        { name: 'Tatsumaki (M)', input: '214MK', damage: '900', startup: '14', active: '2x4', recovery: '20', onBlock: '-8', onHit: 'KD', category: 'special', knockdown: { type: 'soft', advantage: 18 } },
        { name: 'Tatsumaki (H)', input: '214HK', damage: '1200', startup: '17', active: '2x5', recovery: '22', onBlock: '-10', onHit: 'KD', category: 'special', knockdown: { type: 'hard', advantage: 30 } },
    ];

    const supers: Move[] = [
        { name: 'Shinku Hadoken (SA1)', input: '236236P', damage: '2000', startup: '8', active: '-', recovery: '45', onBlock: '-15', onHit: 'KD', category: 'super', knockdown: { type: 'hard', advantage: 60 } },
        { name: 'Shin Hashogeki (SA2)', input: '236236K', damage: '2500', startup: '9', active: '8', recovery: '40', onBlock: '-20', onHit: 'KD', category: 'super', knockdown: { type: 'hard', advantage: 50 } },
        { name: 'Shin Shoryuken (SA3)', input: '236236P (CA)', damage: '4500', startup: '7', active: '3', recovery: '55', onBlock: '-40', onHit: 'KD', category: 'super', knockdown: { type: 'hard', advantage: 80 } },
    ];

    const throws: Move[] = [
        { name: 'Throw (Forward)', input: 'LP+LK', damage: '1200', startup: '5', active: '3', recovery: '23', onBlock: '-', onHit: 'KD', category: 'throw', knockdown: { type: 'soft', advantage: 15 } },
        { name: 'Throw (Back)', input: '4LP+LK', damage: '1400', startup: '5', active: '3', recovery: '23', onBlock: '-', onHit: 'KD', category: 'throw', knockdown: { type: 'soft', advantage: 20 } },
    ];

    return {
        character: {
            id: config.id,
            name: config.name,
            nameJp: config.nameJp,
        },
        moves: [...normals, ...uniqueMoves, ...specials, ...supers, ...throws],
        lastUpdated: new Date().toISOString().split('T')[0],
    };
}

function saveFrameData(data: FrameData): void {
    const filePath = path.join(OUTPUT_DIR, `${data.character.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    console.log(`Saved: ${filePath} (${data.moves.length} moves)`);
}

async function main() {
    const args = process.argv.slice(2);
    const isDemo = args.includes('--demo');
    const targetCharacter = args.find(a => !a.startsWith('--'));

    let targets = CHARACTERS;

    if (targetCharacter) {
        const found = CHARACTERS.find(c => c.id === targetCharacter);
        if (!found) {
            console.error(`Character not found: ${targetCharacter}`);
            console.log('Available characters:', CHARACTERS.map(c => c.id).join(', '));
            process.exit(1);
        }
        targets = [found];
    }

    console.log(`\n🎮 SF6 Frame Data Scraper\n`);
    console.log(`Mode: ${isDemo ? 'Demo Data' : 'Scraping'}`);
    console.log(`Targets: ${targets.length} character(s)\n`);

    for (const config of targets) {
        let data: FrameData | null = null;

        if (isDemo) {
            data = generateDemoData(config);
        } else {
            data = await scrapeCharacter(config);

            // Fallback to demo data if scraping fails
            if (!data || data.moves.length === 0) {
                console.log(`  -> Using demo data for ${config.name}`);
                data = generateDemoData(config);
            }
        }

        if (data) {
            saveFrameData(data);
        }
    }

    console.log(`\n✅ Done!`);
}

main().catch(console.error);
