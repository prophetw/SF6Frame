/**
 * Parse Local HTML File - Version 2.0 (Move Container Logic)
 * 
 * Target URL: https://wiki.supercombo.gg/w/Street_Fighter_6/Terry
 */

import * as cheerio from 'cheerio';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

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

function categorizeMove(name: string, input: string): Move['category'] {
    const lowerName = name.toLowerCase();
    const lowerInput = input.toLowerCase();

    if (lowerName.includes('throw') || lowerInput.includes('lp+lk')) return 'throw';
    if (lowerInput.includes('sa') || lowerName.includes('super')) return 'super';
    if (lowerInput.includes('qcf') || lowerInput.includes('qcb') || lowerInput.includes('dp') || lowerInput.includes('hcf') || lowerInput.includes('236') || lowerInput.includes('214') || lowerInput.includes('623')) return 'special';
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
    const htmlPath = args[0];
    const characterId = args[1];

    if (!htmlPath || !characterId) {
        console.error('Usage: pnpm exec tsx scripts/parse-local-html.ts <html_file_path> <character_id>');
        process.exit(1);
    }

    if (!fs.existsSync(htmlPath)) {
        console.error(`File not found: ${htmlPath}`);
        process.exit(1);
    }

    console.log(`Parsing ${htmlPath} for character: ${characterId}...`);

    const htmlContent = fs.readFileSync(htmlPath, 'utf-8');
    const $ = cheerio.load(htmlContent);
    const moves: Move[] = [];

    // Select all move containers
    $('.movedata-container').each((_, container) => {
        const $container = $(container);

        // Extract Name and Input from the header section above the table
        // Structure: .movedata-flex-framedata-name -> children divs
        const $nameContainer = $container.find('.movedata-flex-framedata-name');

        // Usually: 1st child = Input (2MP), 2nd child = Full Name (Crouching Medium Punch)
        // Sometimes only 1 child exists.
        const nameItems = $nameContainer.find('.movedata-flex-framedata-name-item');

        let input = '';
        let name = '';

        if (nameItems.length >= 2) {
            input = $(nameItems[0]).text().trim();
            name = $(nameItems[1]).text().trim();
        } else if (nameItems.length === 1) {
            name = $(nameItems[0]).text().trim();
            input = name; // Fallback
        } else {
            // Check if name is in the H5 header above the container? 
            // In the HTML sample: <h5 id="2MP">...</h5> <div class="movedata-container">
            // But we are inside the container.
            // Let's rely on what we found relative to container or just skip unique edge cases for now.
            return;
        }

        // Clean up text (sometimes includes newlines or extra spaces)
        input = input.replace(/\s+/g, ' ').trim();
        name = name.replace(/\s+/g, ' ').trim();

        // -------------------------------------------------------------
        // Extract Frame Data from the internal table
        // -------------------------------------------------------------
        const $table = $container.find('table.wikitable');
        if ($table.length === 0) return;

        // Parse Headers to find column indices
        const headers: string[] = [];
        $table.find('tr:first-child th').each((_, th) => {
            headers.push($(th).text().trim().toLowerCase());
        });

        // We expect headers like: startup, active, recovery, damage, guard, on hit, on block
        const idx = {
            damage: headers.findIndex(h => h.includes('damage')),
            startup: headers.findIndex(h => h.includes('startup')),
            active: headers.findIndex(h => h.includes('active')),
            recovery: headers.findIndex(h => h.includes('recovery')),
            onBlock: headers.findIndex(h => h.includes('block')),
            onHit: headers.findIndex(h => h.includes('hit')),
        };

        // Get the data row (usually the 2nd row, index 1)
        const $dataRow = $table.find('tr').eq(1); // 0 is header, 1 is data
        const $cells = $dataRow.find('td');

        const getCell = (index: number) => {
            if (index === -1 || index >= $cells.length) return '-';
            return $($cells[index]).text().trim().replace(/\n/g, '');
        };

        const move: Move = {
            name,
            input,
            damage: getCell(idx.damage),
            startup: getCell(idx.startup),
            active: getCell(idx.active),
            recovery: getCell(idx.recovery),
            onBlock: getCell(idx.onBlock),
            onHit: getCell(idx.onHit),
            category: categorizeMove(name, input),
        };

        // Knockdown detection from "On Hit" text or full row text
        const rawRowText = $dataRow.text().toLowerCase();
        if (rawRowText.includes('kd') || rawRowText.includes('knockdown') || move.onHit.toLowerCase().includes('kd')) {
            move.knockdown = {
                type: 'hard',
                advantage: estimateKnockdownAdvantage(move),
            };
        }

        moves.push(move);
    });

    if (moves.length === 0) {
        console.error('No moves found! Check if the HTML file contains ".movedata-container" elements.');
        process.exit(1);
    }

    // Sort moves to put normals first, then specials, then supers
    const categoryOrder = { 'normal': 1, 'unique': 2, 'throw': 3, 'special': 4, 'super': 5 };
    moves.sort((a, b) => (categoryOrder[a.category] || 99) - (categoryOrder[b.category] || 99));

    const characterName = characterId.charAt(0).toUpperCase() + characterId.slice(1);
    const frameData: FrameData = {
        character: {
            id: characterId,
            name: characterName,
            nameJp: characterName,
        },
        moves,
        lastUpdated: new Date().toISOString().split('T')[0],
    };

    const outputPath = path.join(OUTPUT_DIR, `${characterId}.json`);
    fs.writeFileSync(outputPath, JSON.stringify(frameData, null, 2));

    console.log(`✓ Saved: ${moves.length} moves to ${characterId}.json`);
    console.log('Sample content (first 3 moves):');
    console.log(JSON.stringify(moves.slice(0, 3), null, 2));
}

main();
