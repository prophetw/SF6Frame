import type { CustomMove } from '../views/OkiCalculatorView.vue';

// Copy localStorage 'sf6_oki_custom_moves' content here
// Value should be an array of CustomMove objects
export const defaultCustomMoves: CustomMove[] = [
    { "id": "1769662007520", "characterId": "ryu", "name": "6HK214HKair", "input": "41~46", "frames": 42 },
    { "id": "1770036486089", "characterId": "ryu", "name": "235HK623MP", "input": "235HK623MP", "frames": 32 },
    {
        "id": "1770253946799",
        "characterId": "ryu",
        "name": "2HK(punish)",
        "input": "2HK(punish)",
        "frames": 47
    }
]