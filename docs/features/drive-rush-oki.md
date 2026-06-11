# 绿冲压起身计算

## 功能目标

在起身计算器中枚举“前置动作 + 绿冲 + 派生动作”的压起身方案，判断我方打击帧是否覆盖对手起身后的可命中窗口，并同步计算绿冲加成、Meaty 加成与打康结果。

## 核心入口

- `src/utils/driveRush.ts`
  - `PARRY_DRIVE_RUSH_ATTACK_CANCEL_FRAME`：Parry Drive Rush 可取消进攻击的基准帧，当前为 `11F`。
  - `getFastestDriveRushHitFrame(startup)`：绿冲派生动作最速命中帧，公式为 `11 + startup`，不再额外 `-1`。
  - `calculateDriveRushAttackTiming(...)`：根据绿冲起点、招式发生和持续段计算动作开始、最速命中与打击范围。
  - `getDriveRushActionTotalFrames(move)`：在前置动作链中把“绿冲 + 招式全帧数”折算为 `11 + moveTotalFrames`。
- `src/views/OkiCalculatorView.vue`
  - 前置动作搜索中可添加 `driveRush` 类型动作。
  - `allOkiResults` 把绿冲动作纳入普通压起身匹配。
  - `allDriveRushOkiResults` 独立枚举“绿冲 + 动作压起身”结果。

## 架构关系

`OkiCalculatorView.vue` 负责 UI 状态、角色招式数据筛选、窗口匹配与结果展示；绿冲专用的基础帧数规则集中在 `src/utils/driveRush.ts`，避免视图内重复实现公式。

绿冲派生动作过滤依赖 `isDriveRushFollowUpMove(move)`：排除投、空中动作和无有效发生帧的招式。绿冲有利帧加成由视图内 `getDriveRushAdvantageBonus(move)` 决定，目前普通技与特殊技获得 `+4F`。

## 数据流

1. 从角色数据读取所有招式，过滤可作为绿冲派生的地面非投动作。
2. 读取击倒优势、对手抢招发生、额外延迟和前置动作。
3. 计算绿冲起点：`prefix.frames + extraDelay`。
4. 计算派生动作最速命中：`driveRushStart + 11 + moveStartup`。
5. 结合持续帧得到打击范围：`firstActive~lastActive`。
6. 与对手可命中窗口比较，生成压制成功或相杀结果。
7. 展示被防、被击结果：原始帧数 + 绿冲加成 + Meaty 加成，命中压起身时再加打康 `+2F`。

## 关键数据结构

- `ComboAction.type = 'driveRush'`：表示前置动作链中加入“绿冲 + 招式”。
- `DriveRushAttackTiming`：包含 `driveRushStartFrame`、`attackStartFrame`、`fastestHitFrame`、`firstActiveFrame`、`lastActiveFrame`。
- `DriveRushOkiResult`：视图用于展示独立绿冲匹配结果，包含前置动作、延迟、派生动作、打击范围、压制判定和加成计算。
- `ExtendedOkiResult.isDriveRush`：普通自动匹配结果中的绿冲标记，用于展开详情时展示绿冲起点和公式。

## 外部依赖或 API

本功能不调用外部服务。数据来自本地 `src/data/characters/*.json`，帧数解析复用 `src/utils/frameTotals.ts` 与 `src/utils/moveFilters.ts`。

## 异常路径

- 招式发生帧无法解析或小于等于 `0`：不作为绿冲派生动作。
- 投技或空中动作：不作为绿冲派生动作。
- 招式被标记 `noMeaty`：不追加 Meaty 加成。
- 多段或带间隔持续帧：展示与 Meaty 计算优先使用最后一段打击范围。
- 对手可命中窗口为空：只能匹配相杀，不能判定压制成功。

## 测试验证方式

- `pnpm test -- src/utils/driveRush.test.ts --run`
  - 覆盖 `11 + startup` 的最速命中公式。
  - 覆盖带前置帧的绿冲派生动作时序。
  - 覆盖前置动作链中的 `11 + moveTotalFrames` 折算。
  - 覆盖绿冲派生动作过滤规则。
- `pnpm build`
  - 验证 Vue 模板中的公式展示与类型检查。

## 变更记录

- 2026-06-11：根据测试反馈，将绿冲（DR）有效偏移/取消进攻击的基准帧从 `10F` 调整为 `11F`；更新公式为 `11 + startup` 及相关文档与测试用例。
- 2026-05-20：修正绿冲派生动作计算公式，从 `10 + startup - 1` 调整为 `10 + startup`；同步更新测试与 UI 公式展示。
