/**
 * Utility functions for calculating trade (clash) scenarios in SF6.
 *
 * Trade Logic:
 * When two moves trade (both hit), both players enter a Counter Hit state.
 * Frame Advantage is determined by whose hitstun ends first.
 * Player A's Advantage = (Hitstun caused by A) - (Hitstun caused by B)
 *
 * Note: Hitstun here refers to the Counter Hit hitstun.
 * CH Hitstun = Base Hitstun + 2.
 */

// Minimal interface for what we need from the raw FAT move data
export interface FATMoveMinimal {
    hitstun?: string | number;
    blockstun?: string | number;
    recovery?: string | number;
    onHit?: string | number;
    [key: string]: any;
}

/**
 * Parses the hitstun value from FAT data.
 * FAT hitstun can be a number (e.g., 18) or a string (e.g., "15*17", "KD +40", "30 total").
 * We aim to extract the first valid integer.
 */
export function parseHitstun(val: string | number | undefined): number {
    if (val === undefined || val === null) {
        return 0;
    }

    if (typeof val === 'number') {
        return val;
    }

    if (typeof val === 'string') {
        // Look for the first sequence of digits
        const match = val.match(/\d+/);
        if (match) {
            return parseInt(match[0], 10);
        }
    }

    return 0;
}

/**
 * Calculates effective hitstun for trade purposes.
 * If base hitstun is found, use it + 2 (Counter Hit).
 * If base hitstun is 0/missing (common for some KD/projectile moves), use raw blockstun + 2.
 */
export function getEffectiveHitstun(move: FATMoveMinimal): { value: number; type: 'normal' | 'blockstun' } {
    let stun = parseHitstun(move.hitstun);

    // If we have a valid hitstun (and not just 0), use it + 2CH
    if (stun > 0) {
        return { value: stun + 2, type: 'normal' };
    }

    // Fallback to blockstun if hitstun is missing
    const blockstun = parseHitstun(move.blockstun);
    if (blockstun > 0) {
        return { value: blockstun + 2, type: 'blockstun' };
    }

    // Default fallback
    return { value: stun + 2, type: 'normal' };
}

/**
 * Calculates the frame advantage for Player A when Move A and Move B trade.
 * Both moves are assumed to be Counter Hits.
 *
 * @param moveA_Raw The raw FAT move object for Player A
 * @param moveB_Raw The raw FAT move object for Player B
 * @returns Frame advantage for Player A (positive means A is advantage, negative means B is advantage)
 */
export function calculateTradeAdvantage(moveA_Raw: FATMoveMinimal, moveB_Raw: FATMoveMinimal): number {
    const effectiveHitstunA = getEffectiveHitstun(moveA_Raw).value;
    const effectiveHitstunB = getEffectiveHitstun(moveB_Raw).value;

    return effectiveHitstunA - effectiveHitstunB;
}
