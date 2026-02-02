## 数据来源

- supercombo: https://wiki.supercombo.gg/w/Street_Fighter_6/Frame_Data

## 帧数说明

```js

const action1 = {
    "name": "Axe Kick",
    "input": "4HK",
    "damage": "400x2",  // 2段伤害
    "startup": "10(20)", // 10空挥 
    "active": "5(5)3",  // 表示 2段持续 中间相隔5帧   5帧+5帧+3帧 总持续时间13帧
    "recovery": "21",
    "onBlock": "-4",
    "onHit": "0",
}

const action2 = {
   "name": "Solar Plexus Strike",
    "input": "6HP",
    "damage": "400x2", // 2段伤害
    "startup": "20",
    "active": "2,3", // 第一段伤害2帧 第二段伤害3帧  2+3=5帧 总持续时间5帧
    "recovery": "16",
    "onBlock": "+3",
    "onHit": "+6",
    "category": "unique",
}

const action3 = {
    "name": "Crouch MP",
    "input": "2MP",
    "damage": "600",
    "startup": "6",
    "active": "4",
    "recovery": "13(15)",  // 13帧击中 15帧未击中
    "onBlock": "0",
    "onHit": "+5",
    "category": "normal",
}

```
