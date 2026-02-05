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
    nameZh?: string;
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
    noMeaty?: boolean; // If true, Meaty bonus is always 0
    notes?: string;
    raw?: any;
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
    { id: 'ryu', name: 'Ryu', nameJp: 'リュウ', wikiUrl: 'https://wiki.supercombo.gg/w/Street_Fighter_6/Ryu' },
    { id: 'ken', name: 'Ken', nameJp: 'ケン', wikiUrl: 'https://wiki.supercombo.gg/w/Street_Fighter_6/Ken' },
    { id: 'luke', name: 'Luke', nameJp: 'ルーク', wikiUrl: 'https://wiki.supercombo.gg/w/Street_Fighter_6/Luke' },
    { id: 'jamie', name: 'Jamie', nameJp: 'ジェイミー', wikiUrl: 'https://wiki.supercombo.gg/w/Street_Fighter_6/Jamie' },
    { id: 'chun-li', name: 'Chun-Li', nameJp: '春麗', wikiUrl: 'https://wiki.supercombo.gg/w/Street_Fighter_6/Chun-Li' },
    { id: 'guile', name: 'Guile', nameJp: 'ガイル', wikiUrl: 'https://wiki.supercombo.gg/w/Street_Fighter_6/Guile' },
    { id: 'kimberly', name: 'Kimberly', nameJp: 'キンバリー', wikiUrl: 'https://wiki.supercombo.gg/w/Street_Fighter_6/Kimberly' },
    { id: 'juri', name: 'Juri', nameJp: 'ジュリ', wikiUrl: 'https://wiki.supercombo.gg/w/Street_Fighter_6/Juri' },
    { id: 'manon', name: 'Manon', nameJp: 'マノン', wikiUrl: 'https://wiki.supercombo.gg/w/Street_Fighter_6/Manon' },
    { id: 'marisa', name: 'Marisa', nameJp: 'マリーザ', wikiUrl: 'https://wiki.supercombo.gg/w/Street_Fighter_6/Marisa' },
    { id: 'dee-jay', name: 'Dee Jay', nameJp: 'ディージェイ', wikiUrl: 'https://wiki.supercombo.gg/w/Street_Fighter_6/Dee_Jay' },
    { id: 'cammy', name: 'Cammy', nameJp: 'キャミィ', wikiUrl: 'https://wiki.supercombo.gg/w/Street_Fighter_6/Cammy' },
    { id: 'lily', name: 'Lily', nameJp: 'リリー', wikiUrl: 'https://wiki.supercombo.gg/w/Street_Fighter_6/Lily' },
    { id: 'zangief', name: 'Zangief', nameJp: 'ザンギエフ', wikiUrl: 'https://wiki.supercombo.gg/w/Street_Fighter_6/Zangief' },
    { id: 'jp', name: 'JP', nameJp: 'JP', wikiUrl: 'https://wiki.supercombo.gg/w/Street_Fighter_6/JP' },
    { id: 'dhalsim', name: 'Dhalsim', nameJp: 'ダルシム', wikiUrl: 'https://wiki.supercombo.gg/w/Street_Fighter_6/Dhalsim' },
    { id: 'honda', name: 'E.Honda', nameJp: 'エドモンド本田', wikiUrl: 'https://wiki.supercombo.gg/w/Street_Fighter_6/E._Honda' },
    { id: 'blanka', name: 'Blanka', nameJp: 'ブランカ', wikiUrl: 'https://wiki.supercombo.gg/w/Street_Fighter_6/Blanka' },
    { id: 'rashid', name: 'Rashid', nameJp: 'ラシード', wikiUrl: 'https://wiki.supercombo.gg/w/Street_Fighter_6/Rashid' },
    { id: 'aki', name: 'A.K.I.', nameJp: 'アキ', wikiUrl: 'https://wiki.supercombo.gg/w/Street_Fighter_6/A.K.I.' },
    { id: 'ed', name: 'Ed', nameJp: 'エド', wikiUrl: 'https://wiki.supercombo.gg/w/Street_Fighter_6/Ed' },
    { id: 'akuma', name: 'Akuma', nameJp: '豪鬼', wikiUrl: 'https://wiki.supercombo.gg/w/Street_Fighter_6/Akuma' },
    { id: 'mbison', name: 'M.Bison', nameJp: 'ベガ', wikiUrl: 'https://wiki.supercombo.gg/w/Street_Fighter_6/M._Bison' },
    { id: 'terry', name: 'Terry', nameJp: 'テリー', wikiUrl: 'https://wiki.supercombo.gg/w/Street_Fighter_6/Terry' },
    { id: 'mai', name: 'Mai', nameJp: '不知火舞', wikiUrl: 'https://wiki.supercombo.gg/w/Street_Fighter_6/Mai' },
    { id: 'elena', name: 'Elena', nameJp: 'エレナ', wikiUrl: 'https://wiki.supercombo.gg/w/Street_Fighter_6/Elena' },
    { id: 'c-viper', name: 'C. Viper', nameJp: 'C. ヴァイパー', wikiUrl: 'https://wiki.supercombo.gg/w/Street_Fighter_6/C.Viper' },
];
