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
    },
    {
        "id": "1772776428815",
        "characterId": "mai",
        "name": "214HP~236LK",
        "input": "214HP~236LK",
        "frames": 30
    },
    {"id":"1779865477582","characterId":"ryu","name":"214HP+绿冲","input":"5HP+214MK","frames":28},
    {
    "id": "1781442904126",
    "characterId": "ken",
    "name": "5mp+5hp",
    "input": "kk+214k",
    "frames": 43
}
]