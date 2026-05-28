# 隆波动拳压起身被防计算

## 功能目标

在压起身计算器的自动匹配结果中，对隆波动拳使用飞行道具压起身公式计算被防优势，避免直接套用表内点防 `onBlock` 数据。

当前自动路由只开放近版边 `236LP` 的实测接触窗口；`236MP`、`236HP`、`236PP` 保留公式工具但不进入自动结果，避免因弹速/距离未建模而产生假阳性。

## 核心入口

- `src/utils/projectileOki.ts`
  - `isRyuHadokenOkiMove(...)`：只识别隆的 `236LP/236MP/236HP/236PP`。
  - `getRyuHadokenOkiData(...)`：从本地招式数据推导本体总帧、防御硬直和点防数据。
  - `calculateRyuHadokenOkiGuardAdvantage(...)`：按 `blockFrameFromInput + blockstun - totalFrames` 计算被防优势。
  - `getRyuHadokenCornerOkiContactWindow(...)`：返回近版边自动路由使用的实测接触窗口，当前只有 `236LP = 21~25F`。
  - `calculateRyuHadokenCornerOkiGuardAdvantage(...)`：只在接触帧落入已校准窗口时返回结果。
- `src/views/OkiCalculatorView.vue`
  - `allOkiResults`：在自动匹配时把波动拳接触帧视为对手起身第 1 帧，换算 `blockFrameFromInput = opponentWakeupFrame - prefixFrames`。
  - 结果详情：对波动拳显示专用公式，并用本体总帧计算恢复帧和防斗反安全。

## 架构关系

波动拳公式集中在 `projectileOki.ts`，视图层只负责提供当前角色、招式和 oki 时间轴里的前置帧。普通打击、绿冲和安全骗压仍沿用原有计算路径。

该逻辑只改变隆 LP 波动拳在 oki 自动匹配中的被防计算与展示，不改写角色 JSON 数据。其他波动拳版本需要补充“输入后第几帧能在近版边实际接触起身”的实测窗口后再进入自动路由。

## 数据流

1. 用户选择隆作为进攻方，并选择有效击倒优势。
2. 自动匹配枚举前置动作 `prefixFrames` 和最终招式。
3. 若最终招式是 `236LP/236MP/236HP/236PP`，计算 UI 坐标下的接触帧：
   `blockFrameFromInput = opponentWakeupFrame - prefixFrames`。
4. 若 `blockFrameFromInput` 落在该版本的近版边接触窗口内，该波动拳可按起身被防路线进入结果。当前只允许 `236LP` 的 `21~25F`。
5. 被防优势按：
   `GuardAdv = blockFrameFromInput + blockstun - totalFrames`。
6. 本体恢复帧按：
   `recoverFrame = prefixFrames + totalFrames`。

## 关键数据结构

- `RyuHadokenOkiData`
  - `startup`：本地数据中的波动拳发生。
  - `recovery`：本地数据中的本体恢复。
  - `totalFrames`：飞行道具本体总帧，当前按 `startup + recovery` 推导。
  - `pointBlankOnBlock`：本地表内点防被防。
  - `blockstun`：由 `totalFrames + pointBlankOnBlock - startup` 反推。
- `RyuHadokenOkiGuardCalculation`
  - `blockFrameFromInput`：从输入到对手实际防住的帧数。
  - `guardAdvantage`：最终被防优势。
  - `contactDelayAfterStartup`：相对点防接触晚到的帧数。
- `ExtendedOkiResult.projectileOki`：视图中标记该结果使用波动拳特殊公式。

## 外部依赖或 API

本功能不调用外部服务。计算只依赖本地 `src/data/characters/ryu.json` 的 `startup`、`recovery` 和 `onBlock`。

普通波动拳当前推导结果：

| 输入 | 发生 | 总帧 | 点防被防 | 防御硬直 | 公式 |
| --- | ---: | ---: | ---: | ---: | --- |
| `236LP` | 16 | 47 | -5 | 26 | `M - 21` |
| `236MP` | 14 | 47 | -7 | 26 | `M - 21` |
| `236HP` | 12 | 47 | -9 | 26 | `M - 21` |
| `236PP` | 12 | 40 | -1 | 27 | `M - 13` |

其中 `M` 是 `blockFrameFromInput`。

近版边 LP 波动拳实用窗口：

| `M` | 被防优势 | 自动路由 |
| ---: | ---: | --- |
| 21 | 0 | 允许 |
| 22 | +1 | 允许 |
| 23 | +2 | 允许 |
| 24 | +3 | 允许 |
| 25 | +4 | 允许 |

资料来源：

- SF6Frames Ryu Special Attacks：列出 LP/MP/HP/OD Hadoken 的发生、活动、总帧与被防数据；页面说明帧数来自游戏内 frame meter。
- Ultimate Frame Data Ryu：列出隆 `236LP/236MP/236HP/236PP` 的发生、总帧、被防与恢复口径。
- DaFeetLee's Dojo Ryu tips：记录近版边 `214LK` 后空挥 `5LP` 接 `236LP`、`623LP` 后空挥 `2LP` 接 `236LP` 的 meaty fireball oki。
- Reddit 讨论 “Question regarding mixups and how they work”：说明 `5LP` 是 frame-kill；若 `214LK` 后立刻出波，波会从起身对手上方/身位错过，空挥轻拳用于把 LP 波调到起身时压住。

## 异常路径

- 当前进攻方不是隆：不启用该特殊公式。
- 招式不是 `236LP/236MP/236HP/236PP`：不启用该特殊公式。
- 招式是 `236MP/236HP/236PP`：当前不进入自动路由，直到补充对应弹速的实测接触窗口。
- `startup`、`recovery` 或 `onBlock` 无法解析：退回普通 oki 路径。
- `236LP` 的 `blockFrameFromInput` 不在 `21~25F`：不显示为自动波动拳 oki 结果。
- 当前计算不验证距离、弹速、角色碰撞体、起身精防、无敌技、超必或穿波选项；这些需要训练模式或后续距离模型补充。

## 测试验证方式

- `pnpm test -- src/utils/projectileOki.test.ts --run`
  - 覆盖隆波动拳输入识别。
  - 覆盖 LP/MP/HP 普通波动拳反推出 26F 防御硬直。
  - 覆盖 `M=16/-5`、`M=24/+3`、`M=25/+4` 等普通波动拳示例。
  - 覆盖 OD 波动拳从本地数据推导 `totalFrames=40`、`blockstun=27`。
  - 覆盖自动路由只允许 `236LP` 的 `21~25F` 接触窗口。
- `pnpm build`
  - 验证 oki 视图模板与类型检查。

## 变更记录

- 2026-05-28：新增隆 `236LP/236MP/236HP/236PP` 波动拳压起身被防特殊计算。
- 2026-05-28：自动路由收窄为近版边 `236LP` 的 `21~25F` 实测接触窗口，避免 MP/HP/OD 和过早出波产生假阳性。
