# 压起身计算器 UI 易用性优化

## 功能目标

降低 `#/oki` 路由在移动端和长结果页中的浏览成本，让用户优先看到核心压起身匹配结果，同时保留循环投、另类压起身、时序图等进阶信息的完整访问能力。

## 核心入口

- `src/App.vue`
  - 移动端顶部导航改为品牌居中、链接横向滚动、语言选择固定在右侧。
- `src/views/OkiCalculatorView.vue`
  - 击倒预设支持搜索，默认只展示部分预设。
  - 自动匹配结果在移动端默认展示前 12 条，可手动展开其余结果。
  - 结果详情中的时序图默认不渲染，点击后再展开。
  - 循环投和另类压起身默认折叠，降低主结果页长度。

## 架构关系

本次调整只改变展示层状态和模板渲染策略，不改动压起身、循环投、绿冲、迸放、安全骗压等帧数计算函数。

`OkiCalculatorView.vue` 继续负责页面状态、筛选和结果展示。新增的 UI 状态只派生展示列表，不修改 `allOkiResults`、`allThrowResults`、`allDriveRushOkiResults` 等核心计算结果。

## 数据流

1. 角色数据加载后生成完整击倒预设 `knockdownMoves`。
2. `knockdownSearchQuery` 过滤完整预设，`visibleKnockdownMoves` 决定当前展示数量。
3. 压起身计算仍生成完整排序结果 `okiResults`。
4. 移动端卡片使用 `visibleOkiResults` 展示前 12 条，用户点击后切换 `showAllAutoResults`。
5. 时序图由 `showResultTimeline` 和 `showThrowTimeline` 控制是否渲染。
6. 循环投和另类压起身分别由 `showThrowSection`、`showAltOkiSection` 控制折叠状态。

## 关键数据结构

- `knockdownSearchQuery`：击倒预设搜索关键字。
- `showAllKnockdownPresets`：控制击倒预设是否展示全部。
- `showAllAutoResults`：控制移动端自动匹配结果是否展示全部。
- `showResultTimeline` / `showThrowTimeline`：控制时序图是否渲染。
- `showThrowSection` / `showAltOkiSection`：控制进阶面板折叠状态。
- `visibleKnockdownMoves`、`visibleOkiResults`、`visibleThrowResults` 等：展示层派生列表。

## 外部依赖或 API

本功能不调用外部服务，不新增依赖。浏览器验证使用项目已有的 `puppeteer` 依赖和本地 Vite 开发服务。

## 异常路径

- 击倒搜索无匹配结果：展示空状态，不影响已选击倒。
- 展示列表被折叠：完整计算结果仍保留在内存中，用户展开后继续查看。
- 时序图未展开：不会渲染时间轴 DOM，避免长详情默认撑高页面。
- 移动端导航链接超出宽度：通过横向滚动访问，不产生页面级横向滚动。

## 测试验证方式

- `pnpm build`
  - 验证 Vue 模板、类型和生产构建。
- Playwright/Puppeteer 浏览器检查
  - 桌面视口 `1440x1000`。
  - 移动视口 `390x844`。
  - 路由：`http://localhost:5173/SF6Frame/#/oki`。
  - 覆盖初始页面、选择攻击方、开启快速自定义击倒、展开结果详情、切换时序图和进阶面板。

## 变更记录

- 2026-05-29：优化移动端导航、击倒预设搜索、移动端结果预览、时序图按需展开、循环投与另类压起身默认折叠。
