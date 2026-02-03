import { describe, it, expect } from 'vitest';
import { calculateGap } from './gapCalculator';
import type { Move } from '../types';

const mockMove = (overrides: Partial<Move>): Move => ({
    name: 'Test Move',
    input: '5MP',
    damage: '800',
    startup: '5',
    active: '3',
    recovery: '15',
    onBlock: '-2',
    onHit: '4',
    category: 'normal',
    ...overrides
});

describe('calculateGap', () => {
    describe('Block Mode (Gap)', () => {
        it('should calculate link gap correctly (Interruptible)', () => {
            // Move 1: -2 on block. Move 2: 5 frame startup.
            // Gap = 5 - (-2) - 1 = 6F.
            const result = calculateGap({
                move1: mockMove({ onBlock: '-2' }),
                move2: mockMove({ startup: '5' }),
                type: 'block',
                mode: 'link',
                hitState: 'normal',
                cancelFrame: 1
            });
            expect(result.gap).toBe(6);
            expect(result.status).toContain('可插动');
            expect(result.valid).toBe(true);
        });

        it('should detect True Blockstring', () => {
            // Move 1: +3 on block. Move 2: 4 frame startup.
            // Gap = 4 - 3 - 1 = 0F.
            const result = calculateGap({
                move1: mockMove({ onBlock: '3' }),
                move2: mockMove({ startup: '4' }),
                type: 'block',
                mode: 'link',
                hitState: 'normal',
                cancelFrame: 1
            });
            expect(result.gap).toBe(0);
            expect(result.status).toContain('连防');
        });

        it('should detect Frame Trap', () => {
            // Move 1: +1 on block. Move 2: 4 frame startup.
            // Gap = 4 - 1 - 1 = 2F.
            const result = calculateGap({
                move1: mockMove({ onBlock: '1' }),
                move2: mockMove({ startup: '4' }),
                type: 'block',
                mode: 'link',
                hitState: 'normal',
                cancelFrame: 1
            });
            expect(result.gap).toBe(2);
            expect(result.status).toContain('Frame Trap');
        });

        // Cancel Mode
        it('should calculate cancel gap correctly', () => {
            // Move 1: Active 4, Recovery 20, OnBlock -5.
            // Blockstun = 4 + 20 - 5 = 19. (Wait formula is Active + Recovery + OnBlock? No wait.)
            // Advantage = Blockstun - (Active + Recovery).
            // So Blockstun = Active + Recovery + Advantage.
            // 4 + 20 + (-5) = 19.

            // Move 2: Startup 10.
            // Cancel Frame: 2.
            // Gap = CancelFrame + (Startup - 1) - Blockstun.
            // Gap = 2 + 9 - 19 = -8. True Blockstring.

            const result = calculateGap({
                move1: mockMove({ active: '4', recovery: '20', onBlock: '-5' }),
                move2: mockMove({ startup: '10' }),
                type: 'block',
                mode: 'cancel',
                hitState: 'normal',
                cancelFrame: 2
            });

            // 19 blockstun.
            // Hit frame relative to cancel: 2 + 9 = 11.
            // 11 - 19 = -8.
            expect(result.gap).toBe(-8);
            expect(result.status).toContain('连防');
            expect(result.blockstun).toBe(19);
        });

        it('should calculate chain cancel gap correctly', () => {
            const result = calculateGap({
                move1: mockMove({ active: '3', recovery: '7', onBlock: '-1', cancels: ['Chain'] }),
                move2: mockMove({ input: '5LP', category: 'normal' }),
                type: 'block',
                mode: 'cancel',
                hitState: 'normal',
                cancelFrame: 1
            });
            expect(result.gap).toBe(0);
            expect(result.status).toContain('连防');
        });
    });

    describe('Hit Mode (Combo)', () => {
        it('should calculate link combo success', () => {
            // +6 on Hit. 5 Startup.
            // Gap/Surplus = 6 - 5 = +1.
            const result = calculateGap({
                move1: mockMove({ onHit: '6' }),
                move2: mockMove({ startup: '5' }),
                type: 'hit',
                mode: 'link',
                hitState: 'normal',
                cancelFrame: 1
            });
            expect(result.gap).toBe(1);
            expect(result.status).toContain('连招成立');
        });

        it('should fail link combo if not enough advantage', () => {
            // +4 on Hit. 5 Startup.
            // Gap = 4 - 5 = -1.
            const result = calculateGap({
                move1: mockMove({ onHit: '4' }),
                move2: mockMove({ startup: '5' }),
                type: 'hit',
                mode: 'link',
                hitState: 'normal',
                cancelFrame: 1
            });
            expect(result.gap).toBe(-1);
            expect(result.status).toContain('连招失败');
        });

        it('should apply Counter Hit modifier', () => {
            // +3 on Hit. CH (+2) -> +5.
            // 5 Startup.
            // Gap = 5 - 5 = 0. Link.
            const result = calculateGap({
                move1: mockMove({ onHit: '3' }),
                move2: mockMove({ startup: '5' }),
                type: 'hit',
                mode: 'link',
                hitState: 'ch',
                cancelFrame: 1
            });
            expect(result.gap).toBe(0);
            expect(result.status).toContain('连招成立');
        });

        it('should apply Punish Counter modifier', () => {
            // +1 on Hit. PC (+4) -> +5.
            // 5 Startup.
            // Gap = 5 - 5 = 0. Link.
            const result = calculateGap({
                move1: mockMove({ onHit: '1' }),
                move2: mockMove({ startup: '5' }),
                type: 'hit',
                mode: 'link',
                hitState: 'pc',
                cancelFrame: 1
            });
            expect(result.gap).toBe(0);
            expect(result.status).toContain('连招成立');
        });

        // Cancel Combo
        it('should calculate cancel combo success', () => {
            // Active 4, Recovery 20, OnHit +5.
            // Hitstun = 4 + 20 + 5 = 29.
            // Move 2 Startup 15.
            // Cancel Frame 1.
            // Hit Frame = 1 + 15 = 16.
            // Surplus = 29 - 16 = 13.
            const result = calculateGap({
                move1: mockMove({ active: '4', recovery: '20', onHit: '5' }),
                move2: mockMove({ startup: '15' }),
                type: 'hit',
                mode: 'cancel',
                hitState: 'normal',
                cancelFrame: 1
            });

            expect(result.gap).toBe(13);
            expect(result.status).toContain('连招成立');
        });

        it('should calculate chain cancel combo success', () => {
            const result = calculateGap({
                move1: mockMove({ active: '3', recovery: '7', onHit: '4', cancels: ['Chain'] }),
                move2: mockMove({ input: '5LP', category: 'normal' }),
                type: 'hit',
                mode: 'cancel',
                hitState: 'normal',
                cancelFrame: 1
            });
            expect(result.gap).toBe(5);
            expect(result.status).toContain('连招成立');
        });
    });
});
