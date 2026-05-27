# 起身斗反安全压与安全骗压

## 功能目标

在压起身计算器中识别两类安全路线：

- 安全压制起身斗反：普通压起身自动匹配结果中，如果我方动作在起身斗反第 18F 生效前已经恢复，则显示“防斗反”标签。
- 安全骗压：枚举“前置动作 + 追加动作 + 额外延迟”的组合，总帧数早于对手起身招式判定时，作为骗凹或骗超必路线展示。

## 核心入口

- `src/utils/wakeupDriveReversal.ts`
  - `WAKEUP_DRIVE_REVERSAL`：起身斗反核心数据，当前为 18F 生效、0-based 生效 offset 为 17、被防 -6。
  - `getActionRecoverFrame(...)`：计算动作恢复帧。
  - `canBlockWakeupDriveReversal(...)`：判断恢复帧是否不晚于起身斗反生效帧。
  - `isSafeBaitTotalFrames(...)`：判断组合总帧是否小于对手起身帧 + 对手招式发生。
- `src/views/OkiCalculatorView.vue`
  - `allOkiResults`：在压起身结果中计算恢复帧、斗反安全余量和“防斗反”标签。
  - `allSafeBaitResults`：在“另类压起身”区域枚举安全骗压路线。

## 架构关系

公式与常量集中在 `wakeupDriveReversal.ts`；`OkiCalculatorView.vue` 只负责把当前击倒优势、对手起身帧、对手招式发生和招式帧数传入工具函数，再把结果展示到压起身列表和安全骗压卡片。

普通压起身仍沿用现有 Oki Routing 的命中窗口匹配逻辑；“防斗反”只是附加安全标签，不改变“压制/相杀”的原判定。

## 数据流

1. 用户选择击倒优势后，视图计算对手起身帧：`opponentWakeupFrame = effectiveKnockdownAdv + 1`。
2. 起身斗反生效帧按同一 1-based UI 坐标换算：`wakeupDriveReversalImpactFrame = opponentWakeupFrame + 17`。
3. 自动匹配压起身时，对每条结果计算动作恢复帧：`prefixFrames + startup + activeWindow + recovery`。
4. 若恢复帧 `<= wakeupDriveReversalImpactFrame`，该结果显示“防斗反”。
5. 安全骗压读取当前对手招式发生，枚举前置与追加动作，计算 `totalFrames = prefix + filler + extraDelay`。
6. 若 `totalFrames < opponentWakeupFrame + opponentStartup`，安全骗压成立，并展示余量。

## 关键数据结构

- `WAKEUP_DRIVE_REVERSAL`：起身斗反固定数据。
- `ExtendedOkiResult.safeAgainstWakeupDriveReversal`：普通压起身结果是否能防斗反。
- `ExtendedOkiResult.recoverFrame`：我方动作恢复帧。
- `ExtendedOkiResult.driveReversalSafetyMargin`：斗反生效帧减去恢复帧。
- `SafeBaitResult`：安全骗压结果，包含前置、追加动作、总帧、安全线与余量。

## 外部依赖或 API

本功能不调用外部服务。招式与击倒数据来自本地 `src/data/characters/*.json`，总帧数解析复用 `src/utils/frameTotals.ts` 和视图内已有的 active/recovery 解析。

## 异常路径

- 无有效击倒优势：不显示 Oki Routing 与安全骗压结果。
- 招式发生、持续或收招无法解析：视图内解析函数会退化为 0 或 1，安全性按当前可解析数据计算。
- 对手未选择具体招式：安全骗压使用手动输入的“对手抢招发生帧”。
- 起身斗反安全只判断能否恢复防御，不代表攻击能打断斗反；斗反第 1F 到第 17F 无敌。

## 测试验证方式

- `pnpm test -- src/utils/wakeupDriveReversal.test.ts --run`
  - 覆盖 18F 起身斗反生效换算。
  - 覆盖安全压制与不安全压制示例。
  - 覆盖安全骗压的严格小于公式。
- `pnpm build`
  - 验证 Vue 模板与类型检查。

## 变更记录

- 2026-05-27：新增起身斗反安全压标签与安全骗压结果模块。
