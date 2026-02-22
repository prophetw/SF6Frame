import type { Move } from '../types';

export type CalculationType = 'block' | 'hit';
export type CalculationMode = 'link' | 'cancel';
export type HitState = 'normal' | 'ch' | 'pc';

export interface CalculationInput {
    move1: Move;
    move2: Move;
    type: CalculationType;
    mode: CalculationMode;
    hitState: HitState;
    cancelFrame: number;
    isOpponentBurnout?: boolean;
    isDriveRush?: boolean;
}

export interface CalculationResult {
    valid: boolean;
    gap: number;
    // UI Display Fields
    displayLabel: string;
    displayValue: string;

    status: string;
    statusClass: string;
    description: string;
    formulaDesc: string;
    adv1: number;
    startup2: number;
    blockstun?: number;
    error?: string;
    formulaNote?: string;
}

export interface DerivedMoveStats {
    blockstun: number;
    hitstun: number;
}

export function parseFrameValue(val: string | number | undefined): number {
    if (typeof val === 'number') return val;
    if (!val) return 0;

    if (val.includes('*')) {
        const parts = val.split('*');
        const last = parts[parts.length - 1];
        if (last) {
            return parseInt(last) || 0;
        }
    }

    const parsed = parseInt(val);
    return isNaN(parsed) ? 0 : parsed;
}

export function calculateMoveStats(move: Move): DerivedMoveStats {
    const active = parseFrameValue(move.active);
    const recovery = parseFrameValue(move.recovery);
    const onBlock = parseFrameValue(move.onBlock);
    const onHit = parseFrameValue(move.onHit);

    let blockstun = 0;
    if (move.raw && typeof move.raw.blockstun === 'number') {
        blockstun = move.raw.blockstun;
    } else {
        blockstun = active + recovery + onBlock;
    }

    let hitstun = 0;
    if (move.raw && typeof move.raw.hitstun === 'number') {
        hitstun = move.raw.hitstun;
    } else {
        hitstun = active + recovery + onHit;
    }

    return { blockstun, hitstun };
}

export function calculateGap(input: CalculationInput): CalculationResult {
    const { move1, move2, type, mode, hitState, cancelFrame, isOpponentBurnout, isDriveRush } = input;

    const adv1Block = parseFrameValue(move1.onBlock);
    const adv1Hit = parseFrameValue(move1.onHit);
    const startup2Num = parseFrameValue(move2.startup);
    const startup2Frames = Math.max(0, startup2Num - 1);
    const isChain = mode === 'cancel' && isChainCancel(move1, move2);

    // Basic validation
    if (isNaN(startup2Num)) {
        return {
            valid: false,
            gap: 0,
            displayLabel: '',
            displayValue: '',
            status: '',
            statusClass: '',
            description: '',
            formulaDesc: '',
            adv1: 0,
            startup2: 0,
            error: '无法获取有效的帧数数据'
        };
    }

    let adv1Num = type === 'block' ? adv1Block : adv1Hit;

    if (type === 'hit') {
        // Apply modifiers
        if (hitState === 'ch') adv1Num += 2;
        if (hitState === 'pc') adv1Num += 4;
    }

    if (isDriveRush) {
        adv1Num += 4;
    }

    if (type === 'block' && isOpponentBurnout) {
        // Defender burnout adds +4 frames on block
        adv1Num += 4;
    }

    let gap = 0;
    let formulaDesc = '';
    let blockstun = 0;
    let status = '';
    let statusClass = '';
    let description = '';

    // Display fields
    let displayLabel = 'Gap (空隙)';
    let displayValue = '';

    // === COMBO MODE (HIT) ===
    if (type === 'hit') {
        if (mode === 'cancel') {
            const stats = calculateMoveStats(move1);
            let hitstun = stats.hitstun;

            if (hitState === 'ch') hitstun += 2;
            if (hitState === 'pc') hitstun += 4;

            if (isChain) {
                const timeToHit = getChainTimeToHit(move1);
                gap = hitstun - timeToHit;
                formulaDesc = `${hitstun} (Hitstun) - (${parseFrameValue(move1.active)} + ${parseFrameValue(move1.recovery)} - 1 Chain)`;
            } else {
                const hitFrame = cancelFrame + startup2Num;
                const surplus = hitstun - hitFrame;
                gap = surplus;
                formulaDesc = `${hitstun} (Hitstun) - (${cancelFrame} + ${startup2Num})`;
            }
        } else {
            gap = adv1Num - startup2Num;
            formulaDesc = `${adv1Num} (Adv) - ${startup2Num} (Startup)`;
        }

        if (gap >= 0) {
            status = '连招成立 (Combo)';
            statusClass = 'status-safe';
            description = '可以连上。';

            displayLabel = '目押窗口 (Surplus)';
            displayValue = `+${gap}F`;
        } else {
            status = '连招失败 (No Combo)';
            statusClass = 'status-danger';
            description = `差 ${Math.abs(gap)} 帧。`;

            // For failed combo, it's a "Gap" or "Deficit"
            displayLabel = '缺失 (Missing)';
            displayValue = `${Math.abs(gap)}F`;
        }

    }
    // === BLOCK MODE (GAP) ===
    else {
        displayLabel = 'Gap (空隙)';

        if (mode === 'link') {
            gap = startup2Num - adv1Num - 1;
            if (isDriveRush || isOpponentBurnout) {
                const baseAdv = adv1Num - (isDriveRush ? 4 : 0) - (isOpponentBurnout ? 4 : 0);
                const modifiers = [
                    isDriveRush ? '+ 4 Drive Rush' : '',
                    isOpponentBurnout ? '+ 4 Opponent Burnout' : ''
                ].filter(Boolean).join(' ');
                formulaDesc = `${startup2Num} (Startup) - (${baseAdv} ${modifiers}) - 1`;
            } else {
                formulaDesc = `${startup2Num} (Startup) - ${adv1Num} (Adv) - 1`;
            }
        } else {
            const stats = calculateMoveStats(move1);
            blockstun = stats.blockstun;

            if (isDriveRush) blockstun += 4;
            if (isOpponentBurnout) blockstun += 4;

            if (isChain) {
                const timeToHit = getChainTimeToHit(move1);
                gap = timeToHit - blockstun;
                if (isDriveRush || isOpponentBurnout) {
                    const baseBlockstun = blockstun - (isDriveRush ? 4 : 0) - (isOpponentBurnout ? 4 : 0);
                    const modifiers = [
                        isDriveRush ? '+ 4 Drive Rush' : '',
                        isOpponentBurnout ? '+ 4 Opponent Burnout' : ''
                    ].filter(Boolean).join(' ');
                    formulaDesc = `${parseFrameValue(move1.active)} + ${parseFrameValue(move1.recovery)} - 1 (Chain) - (${baseBlockstun} ${modifiers})`;
                } else {
                    formulaDesc = `${parseFrameValue(move1.active)} + ${parseFrameValue(move1.recovery)} - 1 (Chain) - ${blockstun} (Blockstun)`;
                }
            } else {
                gap = cancelFrame + startup2Frames - blockstun;

                if (isDriveRush || isOpponentBurnout) {
                    const baseBlockstun = blockstun - (isDriveRush ? 4 : 0) - (isOpponentBurnout ? 4 : 0);
                    const modifiers = [
                        isDriveRush ? '+ 4 Drive Rush' : '',
                        isOpponentBurnout ? '+ 4 Opponent Burnout' : ''
                    ].filter(Boolean).join(' ');
                    formulaDesc = `${cancelFrame} (CancelFrame) + ${startup2Num} - 1 (Startup) - (${baseBlockstun} ${modifiers})`;
                } else {
                    formulaDesc = `${cancelFrame} (CancelFrame) + ${startup2Num} - 1 (Startup) - ${blockstun} (Blockstun)`;
                }
            }
        }
        if (gap <= 0) {
            status = '连防 (True Blockstring)';
            statusClass = 'status-safe';
            description = '真的连防，对手无法出任何招式，还处在防御硬直中。';
        } else if (gap < 4) {
            // Gap 0, 1, 2, 3
            status = 'Frame Trap (伪连/无敌技确反)';
            statusClass = 'status-trap';
            description = '正常出招会被打康，但无敌帧的OD升龙或SA1/2/3可以放出来。';
        } else if (gap >= 4 && gap <= 9) {
            // Gap >= 4 and <= 9
            status = '可插动 (Interruptible)';
            statusClass = 'status-warning';
            description = '间隙较大，对手可以使用4帧抢动，或使用无敌技。';
        } else {
            // Gap > 9
            status = '高风险 / 易被插 (High Risk)';
            statusClass = 'status-danger';
            description = '间隙过大，容易被跳入、大伤害技确反。';
        }

        displayValue = `${gap}F`;
    }

    // Formula explanation note removed as requested
    // Logic is now consistent: simple addition of startup frames.

    return {
        valid: true,
        gap,
        displayLabel,
        displayValue,
        status,
        statusClass,
        description,
        adv1: adv1Num,
        startup2: startup2Num,
        formulaDesc,
        // formulaNote, // Removed
        blockstun: type === 'block' && mode === 'cancel' ? blockstun : undefined
    };
}

// === Helper for Cancel Validation ===
export function getSuperLevel(move: Move): number {
    if (move.category !== 'super') return 0;

    // Check raw data first if available
    if (move.raw?.cmnName) {
        if (move.raw.cmnName.includes('Level 1')) return 1;
        if (move.raw.cmnName.includes('Level 2')) return 2;
        if (move.raw.cmnName.includes('Level 3')) return 3;
        if (move.raw.cmnName.includes('Critical Art')) return 3;
    }

    // Fallback to name check
    if (move.name.includes('SA1') || move.input.includes('236236P')) return 1; // Heuristic
    // Note: Ryu SA1 is 236236P. SA2 is 214214P. SA3 is 236236K.

    return 0;
}

function isGroundedMove(move: Move): boolean {
    const input = (move.input || '').toLowerCase().trim();
    const name = (move.name || '').toLowerCase();
    const rawName = (move.raw?.moveName || '').toLowerCase();
    // Basic airborne detection for jump normals/specials
    if (input.startsWith('j') || input.includes('j.')) return false;
    if (name.includes('jump') || rawName.includes('jump')) return false;
    return true;
}

function isLightNormal(move: Move): boolean {
    if (move.category !== 'normal') return false;
    const input = (move.input || '').toUpperCase();
    if (input.includes('~')) return false;
    const name = (move.name || '').toLowerCase();
    const rawName = (move.raw?.moveName || '').toLowerCase();
    const nameZh = (move.nameZh || '');
    if (input.includes('LP') || input.includes('LK')) return true;
    if (name.includes('light') || rawName.includes('light')) return true;
    if (nameZh.includes('轻')) return true;
    return false;
}

function isDriveRushCancelMove(move: Move): boolean {
    const input = (move.input || '').toLowerCase();
    const name = (move.name || '').toLowerCase();
    const nameZh = (move.nameZh || '').toLowerCase();
    return (
        name.includes('drive rush cancel') ||
        nameZh.includes('斗气冲锋取消') ||
        input.includes('mpmk or 66') ||
        input.includes('66 (cancel)')
    );
}

function isExcludedDriveInput(move: Move): boolean {
    const input = (move.input || '').replace(/\s+/g, '').toUpperCase();
    return input === 'MPMK' || input === 'MPMK~66';
}

function parseOnBlockForSort(val: string | number | undefined): number {
    if (val === undefined || val === null || val === '-') return -999;
    if (typeof val === 'number') return val;
    const match = String(val).match(/^[+-]?\d+/);
    return match ? parseInt(match[0], 10) : -999;
}

function getGapPenalty(gap: number): number {
    return Math.max(0, gap - 3);
}

function getOnBlockPenalty(onBlock: number): number {
    return Math.max(0, -3 - onBlock);
}

function getPressurePriorityScore(gap: number, onBlock: number): number {
    return getGapPenalty(gap) + getOnBlockPenalty(onBlock);
}

function isChainCancel(sourceMove: Move, targetMove: Move): boolean {
    if (!sourceMove.cancels || sourceMove.cancels.length === 0) return false;
    const hasChain = sourceMove.cancels.some(t => t.toUpperCase() === 'CHAIN' || t.toUpperCase() === 'CHN');
    if (!hasChain) return false;
    return targetMove.category?.toLowerCase() === 'normal' && isGroundedMove(targetMove) && isLightNormal(targetMove);
}

function getChainTimeToHit(move: Move): number {
    const active = parseFrameValue(move.active);
    const recovery = parseFrameValue(move.recovery);
    return active + Math.max(0, recovery - 1);
}

export function isCancelValid(sourceMove: Move, targetMove: Move): boolean {
    if (!sourceMove.cancels || sourceMove.cancels.length === 0) return false;

    const cancelTags = sourceMove.cancels.map(t => t.toUpperCase());
    const targetCat = targetMove.category?.toLowerCase() || '';
    const sourceGrounded = isGroundedMove(sourceMove);
    const targetGrounded = isGroundedMove(targetMove);

    if (sourceGrounded && !targetGrounded) return false;

    for (const tag of cancelTags) {
        // "Sp" or "Special" -> Special Moves
        if (tag === 'SPECIAL' || tag === 'SP') {
            if (targetCat === 'special') return true;
        }
        // "SA" or "Super" -> Super Arts (Any Level)
        else if (tag === 'SUPER' || tag === 'SA') {
            if (targetCat === 'super') return true;
        }
        // "Chn" or "Chain" -> Chain Combos (Rapid Cancel)
        // Usually target must be a normal. 
        // We'll allow normals if "Chn" is present.
        else if (tag === 'CHAIN' || tag === 'CHN') {
            if (targetCat === 'normal' && isGroundedMove(targetMove) && isLightNormal(targetMove)) return true;
        }
        // Drive Rush cancel
        else if (tag === 'DR' || tag === 'DRIVE' || tag === 'DRIVE RUSH') {
            if (targetMove.raw?.moveType === 'drive') return true;
            if (targetMove.name.includes('Drive Rush') || targetMove.input.includes('66 (cancel)')) return true;
        }
        // Specific Super Levels
        else if (tag === 'SA3' || tag === 'CA') {
            if (targetCat === 'super' && getSuperLevel(targetMove) === 3) return true;
        }
        else if (tag === 'SA2') {
            if (targetCat === 'super' && getSuperLevel(targetMove) === 2) return true;
        }
        else if (tag === 'SA1') {
            if (targetCat === 'super' && getSuperLevel(targetMove) === 1) return true;
        }
    }

    return false;
}

export interface RecommendedMove {
    move: Move;
    gap: number;
    reason: string;
}

export function findRecommendedMoves(
    move1: Move,
    allMoves: Move[],
    type: CalculationType,
    mode: CalculationMode,
    hitState: HitState,
    cancelFrame: number = 1,
    isOpponentBurnout: boolean = false,
    isDriveRush: boolean = false
): RecommendedMove[] {
    const recommendations: RecommendedMove[] = [];

    // Filter valid moves first
    let candidates = allMoves;
    if (mode === 'cancel') {
        candidates = allMoves.filter(m => isCancelValid(move1, m));
        // If cancels includes special/super, we should restrict to those categories
    } else {
        // For Link, generally exclude throws unless setup? usually normals/command normals
        // Keeping it broad for now, but maybe filter out moves with no startup or weird moves
        candidates = allMoves.filter(m => m.category !== 'throw' && m.raw?.moveType !== 'drive');
    }
    candidates = candidates.filter(m => !isExcludedDriveInput(m));

    for (const move2 of candidates) {
        // Skip self if needed, or obviously bad moves? 
        // Just calculate
        const result = calculateGap({
            move1,
            move2,
            type,
            mode,
            hitState,
            cancelFrame,
            isOpponentBurnout,
            isDriveRush
        });

        if (!result.valid) continue;

        let isRecommended = false;
        let reason = '';

        if (type === 'hit') {
            // Combo Mode
            if (result.gap >= 0) {
                isRecommended = true;
                reason = `Combo +${result.gap}F`;
            }
        } else {
            // Block Mode (Pressure)
            if (mode === 'cancel') {
                isRecommended = true;
                reason = `Gap ${result.gap}F`;
            } else if (result.gap <= 0) {
                isRecommended = true;
                reason = `True Blockstring ${result.gap}F`;
            } else if (result.gap <= 3) {
                isRecommended = true;
                reason = `Frame Trap ${result.gap}F`;
            }
        }

        if (isRecommended) {
            recommendations.push({
                move: move2,
                gap: result.gap,
                reason
            });
        }
    }

    // Sort by best option
    // For Combos (Hit): Smaller gap is usually tighter link, but larger gap is easier link. 
    // Usually we want to show all possible combos. Maybe sort by damage? We don't have damage parsed easily yet.
    // Let's sort by Gap value.

    // For Block: Tighter gap (closer to 0 or negative) is better pressure? 
    // Or 3-4f gap is good frame trap.

    return recommendations.sort((a, b) => {
        const isDRCA = isDriveRushCancelMove(a.move);
        const isDRCB = isDriveRushCancelMove(b.move);
        if (isDRCA && !isDRCB) return -1;
        if (!isDRCA && isDRCB) return 1;

        if (type === 'block') {
            const onBlockA = parseOnBlockForSort(a.move.onBlock);
            const onBlockB = parseOnBlockForSort(b.move.onBlock);
            const scoreA = getPressurePriorityScore(a.gap, onBlockA);
            const scoreB = getPressurePriorityScore(b.gap, onBlockB);
            if (scoreA !== scoreB) return scoreA - scoreB;
            if (a.gap !== b.gap) return a.gap - b.gap; // smaller gap first
            if (onBlockA !== onBlockB) return onBlockB - onBlockA; // higher on-block first
        }

        // Prioritize Drive Rush (66 cancel)
        const isDRA = a.move.name.includes('Drive Rush') || a.move.input.includes('66 (cancel)');
        const isDRB = b.move.name.includes('Drive Rush') || b.move.input.includes('66 (cancel)');

        if (isDRA && !isDRB) return -1;
        if (!isDRA && isDRB) return 1;

        // Sort by Gap (smaller gap / tighter link or pressure is usually better default)
        return a.gap - b.gap;
    });
}
