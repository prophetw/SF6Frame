/**
 * Add Chinese move names (nameZh) into character JSON files.
 *
 * Usage:
 *   node scripts/add-move-zh.js          # all characters
 *   node scripts/add-move-zh.js ryu      # single character
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CHAR_DIR = path.join(__dirname, '../src/data/characters');

const BUTTON_ZH = {
  LP: '轻拳',
  MP: '中拳',
  HP: '重拳',
  LK: '轻脚',
  MK: '中脚',
  HK: '重脚',
};

const NORMAL_PREFIX_ZH = {
  Stand: '站立',
  Crouch: '蹲下',
  Jump: '跳跃',
  'Neutral Jump': '垂直跳跃',
};

const EXACT_NAME_ZH = {
  // System
  'Drive Parry': '斗气招架',
  'Parry Drive Rush': '斗气冲锋',
  'Drive Rush Cancel': '斗气冲锋取消',

  // Ryu / Shoto staples
  Hadoken: '波动拳',
  Shoryuken: '升龙拳',
  'Tatsumaki Senpu-kyaku': '龙卷旋风脚',
  'Aerial Tatsumaki Senpu-kyaku': '空中龙卷旋风脚',
  Hashogeki: '波掌击',
  'Denjin Charge': '电刃练气',
  'Denjin Charge Hadoken': '练气 波动拳',
  'Denjin Charge Hashogeki': '练气 波掌击',
  'Shinku Hadoken': '真空波动拳',
  'Denjin Hadoken': '电刃波动拳',
  'Shin Shoryuken': '真·升龙拳',
  'Shin Shoryuken (CA)': '真·升龙拳（CA）',
  'Shin Hashogeki Lv.1': '真·波掌击 Lv.1',
  'Shin Hashogeki Lv.2': '真·波掌击 Lv.2',
  'Shin Hashogeki Lv.3': '真·波掌击 Lv.3',
  'Denjin Hashogeki Lv.1': '练气 真·波掌击 Lv.1',
  'Denjin Hashogeki Lv.2': '练气 真·波掌击 Lv.2',
  'Denjin Hashogeki Lv.3': '练气 真·波掌击 Lv.3',

  // Chun-Li staples
  Kikoken: '气功拳',
  'Lightning Kick Barrage': '百裂连腿',
  'Spinning Bird Kick': '回旋鹤脚',

  // Guile staples
  'Sonic Boom': '音速波',
  'Somersault Kick': '空翻脚刀',

  // Cammy staples
  'Spiral Arrow': '螺旋箭',
  'Cannon Spike': '加农尖刺',
};

function translateDirectionalTaunt(name) {
  if (!name.endsWith(' Taunt')) return undefined;
  const prefix = name.replace(/ Taunt$/, '').trim();
  const parts = prefix.split('~').map(p => p.trim()).filter(Boolean);
  if (parts.length === 0) return undefined;

  const dirMap = {
    Neutral: '原地',
    Down: '下蹲',
    Forward: '前',
    Back: '后',
  };

  const mapped = parts.map(p => dirMap[p] ?? p);
  return `${mapped.join('~')}挑衅`;
}

function translateNormalButtonName(name) {
  const m = name.match(/^(Stand|Crouch|Jump|Neutral Jump) (LP|MP|HP|LK|MK|HK)(?: \\(([^)]+)\\))?$/);
  if (!m) return undefined;
  const prefix = m[1];
  const btn = m[2];
  const suffixRaw = m[3];

  const prefixZh = NORMAL_PREFIX_ZH[prefix] ?? prefix;
  const btnZh = BUTTON_ZH[btn] ?? btn;

  let suffix = '';
  if (suffixRaw) {
    const s = suffixRaw.trim().toLowerCase();
    if (s === 'hold') suffix = '（长按）';
    else suffix = `（${suffixRaw}）`;
  }

  return `${prefixZh}${btnZh}${suffix}`;
}

function getMoveNameZh(move) {
  // Input-based universal mappings
  if (move.input === 'HPHK') return '斗气迸放';
  if (move.input === '6HPHK') return '斗气反攻';

  // Taunts (special-case Neutral => 原地)
  const tauntZh = translateDirectionalTaunt(move.name);
  if (tauntZh) return tauntZh;

  // Exact mappings
  if (EXACT_NAME_ZH[move.name]) return EXACT_NAME_ZH[move.name];

  // Stand/Crouch/Jump button normals
  const normalZh = translateNormalButtonName(move.name);
  if (normalZh) return normalZh;

  // No best-effort / token-based translation here on purpose.
  return undefined;
}

function reorderMove(move) {
  const orderedKeys = [
    'name',
    'nameZh',
    'input',
    'damage',
    'startup',
    'active',
    'recovery',
    'onBlock',
    'onHit',
    'category',
    'cancels',
    'knockdown',
    'notes',
    'raw',
  ];

  const out = { name: move.name };
  for (const key of orderedKeys) {
    if (key === 'name') continue;
    if (move[key] !== undefined) out[key] = move[key];
  }
  for (const [key, value] of Object.entries(move)) {
    if (out[key] === undefined) out[key] = value;
  }
  return out;
}

function listTargetFiles(characterId) {
  const all = fs.readdirSync(CHAR_DIR).filter(f => f.endsWith('.json'));
  if (!characterId) return all.map(f => path.join(CHAR_DIR, f));
  const target = `${characterId}.json`;
  if (!all.includes(target)) {
    throw new Error(`Character file not found: ${target}`);
  }
  return [path.join(CHAR_DIR, target)];
}

function main() {
  const arg = process.argv[2];
  const files = listTargetFiles(arg);

  let touchedFiles = 0;
  let added = 0;
  let updated = 0;
  let removed = 0;

  for (const filePath of files) {
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);
    if (!Array.isArray(data.moves)) continue;

    let changed = false;
    for (const move of data.moves) {
      const desired = getMoveNameZh(move);

      if (!desired) {
        if (move.nameZh !== undefined) {
          delete move.nameZh;
          removed++;
          changed = true;
        }
        continue;
      }

      if (move.nameZh === desired) continue;

      if (move.nameZh === undefined) added++;
      else updated++;

      move.nameZh = desired;
      changed = true;
    }

    if (!changed) continue;

    data.moves = data.moves.map(reorderMove);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
    touchedFiles++;
  }

  console.log(
    `Done. Files updated: ${touchedFiles}. nameZh added: ${added}, updated: ${updated}, removed: ${removed}.`,
  );
}

main();
