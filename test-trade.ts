
import { parseHitstun, calculateTradeAdvantage, FATMoveMinimal } from './src/utils/trade';

// Mock Data
const moveStun15: FATMoveMinimal = { hitstun: 15 };
const moveStun17: FATMoveMinimal = { hitstun: 17 };
const moveStunString: FATMoveMinimal = { hitstun: "31*23" }; // Should be 31
const moveStunKD: FATMoveMinimal = { hitstun: "KD +40" }; // Should be 0? Or parse first number? 
// Current logic: first number found. "KD +40" -> 40.
// Wait, if it's "KD +40", usually that means onHit frame advantage is +40, but hitstun field might just say "KD".
// Let's check Ryu's Crouch HK again.
// Raw: "hitstun": "KD" (Wait, I saw 33 earlier? Let me re-verify Ryu's JSON content)

// Re-verification from previous file view:
// Line 318: "hitstun": 33, (Stand HK)
// Line 497: "hitstun": "27(22)", (Crouch HP)
// Line 650: "onHit": "KD +40",
// Line 653: "advantage": 40
// Line 655: "raw": { ... "onHit": "KD +40" ... }
// Wait, look at Ryu JSON line 668: "dmg": 900. Where is hitstun?
// JSON Line 669: "blockstun": 19.
// JSON Line 670: "hitstop": 13.
// IT DOES NOT HAVE HITSTUN FIELD in Raw for Crouch HK?
// Let's re-read the file view output for Crouch HK (item 12).
// Lines 655-690 (Raw object)
// 669: blockstun
// 670: hitstop
// 671: jugLimit
// It seems `hitstun` is missing from the raw FAT object for Crouch HK!
// This is important. If hitstun is missing, we need to fallback or handle it.
// Actually, usually KD moves don't have hitstun because they knock down.
// But some might have it.

const moveMissingStun: FATMoveMinimal = { onHit: "KD" }; // undefined hitstun

function test() {
    console.log("Testing parseHitstun...");
    console.log(`15 -> ${parseHitstun(15)} (Exp: 15)`);
    console.log(`"15*17" -> ${parseHitstun("15*17")} (Exp: 15)`);
    console.log(`"27(22)" -> ${parseHitstun("27(22)")} (Exp: 27)`);
    console.log(`undefined -> ${parseHitstun(undefined)} (Exp: 0)`);

    console.log("\nTesting calculateTradeAdvantage...");

    // Case 1: 15 vs 17 (A vs B)
    // A hitstun: 15+2 = 17. B hitstun: 17+2 = 19.
    // Adv A = 17 - 19 = -2. (B is +2)
    const adv1 = calculateTradeAdvantage(moveStun15, moveStun17);
    console.log(`A(15) vs B(17) -> ${adv1} (Exp: -2)`);

    // Case 2: 31 vs 27
    // A(31) vs B(27). Adv = 31 - 27 = +4.
    const adv2 = calculateTradeAdvantage(moveStunString, { hitstun: "27(22)" });
    console.log(`A("31*23") vs B("27(22)") -> ${adv2} (Exp: 4)`);
}

test();
