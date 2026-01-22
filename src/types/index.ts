// SF6 Frame Data Types

export interface Character {
    id: string;
    name: string;
    nameJp?: string;
    portrait?: string;
    wikiUrl?: string;
}

export interface CharacterStats {
    health: number;
    forwardDash: number;  // Forward dash total frames
    backDash: number;     // Back dash total frames
    forwardWalk?: number; // Forward walk speed
    backWalk?: number;    // Back walk speed
}

export type MoveCategory = 'normal' | 'unique' | 'special' | 'super' | 'throw';
export type KnockdownType = 'soft' | 'hard' | 'none';

export interface KnockdownData {
    type: KnockdownType;
    advantage: number; // frames of advantage on knockdown
    backRiseAdvantage?: number; // frames if opponent back rises
}

export interface Move {
    name: string;
    input: string;
    damage: string;
    startup: string;
    active: string;
    recovery: string;
    onBlock: string;
    onHit: string;
    category: MoveCategory;
    cancels?: string[];  // What the move can cancel into (Special, Super, Chain, etc.)
    knockdown?: KnockdownData;
    notes?: string;
}

export interface FrameData {
    character: Character;
    stats: CharacterStats;
    moves: Move[];
    lastUpdated: string;
}

export interface OkiResult {
    move: Move;
    timing: number; // frames to wait before executing
    activeFrameHit: number; // which active frame hits (1 = first active frame)
    isMeaty: boolean;
    notes?: string;
}

// Character list configuration
export const SF6_CHARACTERS: Character[] = [
    { id: 'ryu', name: 'Ryu', nameJp: 'リュウ' },
    { id: 'ken', name: 'Ken', nameJp: 'ケン' },
    { id: 'luke', name: 'Luke', nameJp: 'ルーク' },
    { id: 'jamie', name: 'Jamie', nameJp: 'ジェイミー' },
    { id: 'chun-li', name: 'Chun-Li', nameJp: '春麗' },
    { id: 'guile', name: 'Guile', nameJp: 'ガイル' },
    { id: 'kimberly', name: 'Kimberly', nameJp: 'キンバリー' },
    { id: 'juri', name: 'Juri', nameJp: 'ジュリ' },
    { id: 'manon', name: 'Manon', nameJp: 'マノン' },
    { id: 'marisa', name: 'Marisa', nameJp: 'マリーザ' },
    { id: 'dee-jay', name: 'Dee Jay', nameJp: 'ディージェイ' },
    { id: 'cammy', name: 'Cammy', nameJp: 'キャミィ' },
    { id: 'lily', name: 'Lily', nameJp: 'リリー' },
    { id: 'zangief', name: 'Zangief', nameJp: 'ザンギエフ' },
    { id: 'jp', name: 'JP', nameJp: 'JP' },
    { id: 'dhalsim', name: 'Dhalsim', nameJp: 'ダルシム' },
    { id: 'honda', name: 'E.Honda', nameJp: 'エドモンド本田' },
    { id: 'blanka', name: 'Blanka', nameJp: 'ブランカ' },
    { id: 'rashid', name: 'Rashid', nameJp: 'ラシード' },
    { id: 'aki', name: 'A.K.I.', nameJp: 'アキ' },
    { id: 'ed', name: 'Ed', nameJp: 'エド' },
    { id: 'akuma', name: 'Akuma', nameJp: '豪鬼' },
    { id: 'mbison', name: 'M.Bison', nameJp: 'ベガ' },
    { id: 'terry', name: 'Terry', nameJp: 'テリー' },
    { id: 'mai', name: 'Mai', nameJp: '不知火舞' },
    { id: 'elena', name: 'Elena', nameJp: 'エレナ' },
];
