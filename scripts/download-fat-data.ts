/**
 * Download real SF6 frame data from FAT (D4RKONION) repository
 * 
 * Usage:
 *   pnpm exec tsx scripts/download-fat-data.ts
 *   pnpm exec tsx scripts/download-fat-data.ts ryu   # Download specific character only
 */

import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FAT_DATA_URL = 'https://raw.githubusercontent.com/D4RKONION/FAT/master/src/js/constants/framedata/SF6FrameData.json';
const OUTPUT_DIR = path.join(__dirname, '../src/data/characters');

// Character ID mapping from FAT names to our IDs
const CHARACTER_ID_MAP: Record<string, string> = {
    'Ryu': 'ryu',
    'Ken': 'ken',
    'Luke': 'luke',
    'Jamie': 'jamie',
    'Chun-Li': 'chun-li',
    'Guile': 'guile',
    'Kimberly': 'kimberly',
    'Juri': 'juri',
    'Manon': 'manon',
    'Marisa': 'marisa',
    'Dee Jay': 'dee-jay',
    'Cammy': 'cammy',
    'Lily': 'lily',
    'Zangief': 'zangief',
    'JP': 'jp',
    'Dhalsim': 'dhalsim',
    'E.Honda': 'honda',
    'Blanka': 'blanka',
    'Rashid': 'rashid',
    'A.K.I.': 'aki',
    'Ed': 'ed',
    'Akuma': 'akuma',
    'M.Bison': 'mbison',
    'Terry': 'terry',
    'Mai': 'mai',
    'Elena': 'elena',
};

// Japanese name mapping
const NAME_JP_MAP: Record<string, string> = {
    'ryu': 'リュウ',
    'ken': 'ケン',
    'luke': 'ルーク',
    'jamie': 'ジェイミー',
    'chun-li': '春麗',
    'guile': 'ガイル',
    'kimberly': 'キンバリー',
    'juri': 'ジュリ',
    'manon': 'マノン',
    'marisa': 'マリーザ',
    'dee-jay': 'ディージェイ',
    'cammy': 'キャミィ',
    'lily': 'リリー',
    'zangief': 'ザンギエフ',
    'jp': 'JP',
    'dhalsim': 'ダルシム',
    'honda': 'エドモンド本田',
    'blanka': 'ブランカ',
    'rashid': 'ラシード',
    'aki': 'アキ',
    'ed': 'エド',
    'akuma': '豪鬼',
    'mbison': 'ベガ',
    'terry': 'テリー',
    'mai': '不知火舞',
    'elena': 'エレナ',
};

// Cancel type display names
const CANCEL_TYPE_MAP: Record<string, string> = {
    'sp': 'Special',
    'su': 'Super',
    'su1': 'SA1',
    'su2': 'SA2',
    'su3': 'SA3',
    'ch': 'Chain',
    'tc': 'Target Combo',
};

interface FATMove {
    moveName: string;
    plnCmd?: string;
    numCmd?: string;
    startup: number | string;
    active?: number | string;
    recovery?: number | string;
    onBlock?: number | string;
    onHit?: number | string;
    dmg?: number | string;
    moveType?: string;
    extraInfo?: string[];
    xx?: string[];  // Cancel types: sp (special), su (super), ch (chain), tc (target combo)
    [key: string]: any;
}

interface FATStats {
    health?: string;
    fDash?: string;  // Forward dash frames
    bDash?: string;  // Back dash frames
    fWalk?: string;  // Forward walk speed
    bWalk?: string;  // Back walk speed
    nJump?: string;  // Neutral jump frames
    fJump?: string;  // Forward jump frames
    bJump?: string;  // Back jump frames
    [key: string]: any;
}

interface FATCharacter {
    moves: {
        [category: string]: {
            [moveName: string]: FATMove;
        };
    };
    stats?: FATStats;
}

type MoveCategory = 'normal' | 'unique' | 'special' | 'super' | 'throw';

interface ConvertedMove {
    name: string;
    input: string;
    damage: string;
    startup: string;
    active: string;
    recovery: string;
    onBlock: string;
    onHit: string;
    category: MoveCategory;
    cancels?: string[];  // What the move can cancel into
    knockdown?: {
        type: 'soft' | 'hard' | 'none';
        advantage: number;
    };
    notes?: string;
    raw?: FATMove; // The complete original object
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
    moves: ConvertedMove[];
    lastUpdated: string;
}

function determineMoveCategory(move: FATMove): MoveCategory {
    const moveType = move.moveType?.toLowerCase() || '';

    if (moveType === 'throw') return 'throw';
    if (moveType === 'super') return 'super';
    if (moveType === 'special') return 'special';
    if (moveType === 'normal') {
        // Check if it's a command normal (unique)
        if (move.movesList === 'Command Normal' || move.movesList === 'Target Combo') {
            return 'unique';
        }
        return 'normal';
    }
    if (moveType === 'drive') return 'special'; // Drive moves as special
    if (moveType === 'taunt') return 'normal';

    return 'normal';
}

function parseKnockdown(onHit: string | number | undefined): { type: 'soft' | 'hard' | 'none'; advantage: number } | undefined {
    if (!onHit) return undefined;

    const hitStr = String(onHit).toUpperCase();

    // Check for knockdown indicators
    if (hitStr.includes('KD') || hitStr.includes('HKD')) {
        // Extract knockdown advantage (e.g., "KD +28" -> 28, "HKD +49" -> 49)
        const match = hitStr.match(/[HK]?KD\s*\+?(\d+)/);
        const advantage = match ? parseInt(match[1]) : 20;
        const type = hitStr.includes('HKD') ? 'hard' : 'soft';
        return { type, advantage };
    }

    return undefined;
}

function parseCancelTypes(xx?: string[]): string[] | undefined {
    if (!xx || xx.length === 0) return undefined;

    return xx.map(cancel => CANCEL_TYPE_MAP[cancel] || cancel).filter(Boolean);
}

function convertFATMove(fatMove: FATMove): ConvertedMove {
    const onHit = fatMove.onHit !== undefined ? String(fatMove.onHit) : '-';
    const cancels = parseCancelTypes(fatMove.xx);

    return {
        name: fatMove.moveName,
        input: fatMove.numCmd || fatMove.plnCmd || '-',
        damage: fatMove.dmg !== undefined ? String(fatMove.dmg) : '-',
        startup: fatMove.startup !== undefined ? String(fatMove.startup) : '-',
        active: fatMove.active !== undefined ? String(fatMove.active) : '-',
        recovery: fatMove.recovery !== undefined ? String(fatMove.recovery) : '-',
        onBlock: fatMove.onBlock !== undefined ? String(fatMove.onBlock) : '-',
        onHit: onHit,
        category: determineMoveCategory(fatMove),
        cancels: cancels,
        knockdown: parseKnockdown(fatMove.onHit),
        notes: fatMove.extraInfo ? fatMove.extraInfo[0] : undefined,
        raw: fatMove,
    };
}

function parseStats(stats?: FATStats): CharacterStats {
    return {
        health: stats?.health ? parseInt(stats.health) : 10000,
        forwardDash: stats?.fDash ? parseInt(stats.fDash) : 0,
        backDash: stats?.bDash ? parseInt(stats.bDash) : 0,
        forwardWalk: stats?.fWalk ? parseFloat(stats.fWalk) : undefined,
        backWalk: stats?.bWalk ? parseFloat(stats.bWalk) : undefined,
    };
}

function convertCharacter(name: string, fatChar: FATCharacter): FrameData | null {
    const id = CHARACTER_ID_MAP[name];
    if (!id) {
        console.log(`  Skipping unknown character: ${name}`);
        return null;
    }

    const moves: ConvertedMove[] = [];

    // Walk through all move categories
    if (fatChar.moves) {
        for (const category of Object.keys(fatChar.moves)) {
            const categoryMoves = fatChar.moves[category];
            if (typeof categoryMoves === 'object') {
                for (const moveName of Object.keys(categoryMoves)) {
                    const fatMove = categoryMoves[moveName];
                    if (fatMove && typeof fatMove === 'object' && fatMove.moveName) {
                        // Skip non-hitting moves for cleaner display
                        if (fatMove.nonHittingMove && fatMove.moveType !== 'drive') continue;

                        moves.push(convertFATMove(fatMove));
                    }
                }
            }
        }
    }

    return {
        character: {
            id,
            name,
            nameJp: NAME_JP_MAP[id] || name,
        },
        stats: parseStats(fatChar.stats),
        moves,
        lastUpdated: new Date().toISOString().split('T')[0],
    };
}

async function main() {
    const args = process.argv.slice(2);
    const targetCharacter = args[0];

    console.log('\n🎮 Downloading SF6 Frame Data from FAT repository...\n');

    // Ensure output directory exists
    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    try {
        // Download FAT data
        console.log(`Fetching: ${FAT_DATA_URL}`);
        const response = await axios.get(FAT_DATA_URL, {
            headers: {
                'User-Agent': 'SF6-Frame-Data-App',
            },
            timeout: 30000,
        });

        const fatData = response.data;
        console.log(`Downloaded data for ${Object.keys(fatData).length} characters\n`);

        let savedCount = 0;

        for (const charName of Object.keys(fatData)) {
            const id = CHARACTER_ID_MAP[charName];

            // Skip if targeting specific character and this isn't it
            if (targetCharacter && id !== targetCharacter) continue;

            const frameData = convertCharacter(charName, fatData[charName]);

            if (frameData) {
                const filePath = path.join(OUTPUT_DIR, `${frameData.character.id}.json`);
                fs.writeFileSync(filePath, JSON.stringify(frameData, null, 2));
                const dashInfo = `fDash: ${frameData.stats.forwardDash}f, bDash: ${frameData.stats.backDash}f`;
                console.log(`✓ Saved: ${charName} (${frameData.moves.length} moves, ${dashInfo}) -> ${frameData.character.id}.json`);
                savedCount++;
            }
        }

        console.log(`\n✅ Done! Saved ${savedCount} character(s) with real frame data.`);

    } catch (error: any) {
        console.error('Failed to download FAT data:', error.message);
        console.log('\nFallback: Run `pnpm exec tsx scripts/scraper.ts --demo` to generate demo data instead');
        process.exit(1);
    }
}

main().catch(console.error);
