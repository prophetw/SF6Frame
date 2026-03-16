# 街霸 6 帧数工具 - 核心招式与连段功能 (Feature: Key Moves & Combos)

## 需求背景与目标 (Requirements)

为了让网站不仅仅是一个枯燥的数据表格，而是更具实战指导意义的工具，此功能旨在为每个角色添加以下两大模块：

1.  **常用连段 (Combos)**: 
    *   收录角色的常用连段，例如：基础确认连段 (Day 1 BnBs)、压制扩展 (Drive Rush Extensions)、确反连段 (Punish Counter Combos) 等。
    *   展示连段指令、伤害值、资源消耗（超必杀/斗气）、难度和相关备注。
2.  **核心招式 (Key Moves)**: 
    *   明确提炼出该角色最厉害、最核心的牵制、防空、或者最需要学习的招式，帮助新手快速掌握角色核心机制。
3.  **UI 展示与集成 (UI Integration)**: 
    *   在前端新增可视化的连系展示。
    *   （可选扩展）后续可考虑与现有的“起身压制计算器 (Oki Calculator)”进行打通，演示这套连段打完之后的压制情况。

---

## 当前进度 (Current Progress)

### ✅ 已完成的部分 (Completed)

我们已经完成了连段数据爬取核心模块的设计和实现：

1.  **数据结构设计 (`src/types/index.ts`)**: 
    *   新增了 `Combo` (单条连段) 和 `ComboData` (单角色的连段集合) 的 TypeScript 类型定义。
2.  **自动化爬虫开发 (`scripts/scraper-combos.ts`)**: 
    *   开发了专门针对 Supercombo Wiki (`/Combos` 页面) 的 Puppeteer 爬虫脚本。
    *   利用现有的 9222 端口机制直接连接宿主机浏览器以绕过 Cloudflare 验证。
    *   支持自动解析 wiki 上的富文本表格 (`sf6-combotable`) 和普通列表形式 (`wikitable`) 的连段数据。
3.  **豪鬼 (Akuma) 数据打样 (`src/data/combos/akuma.json`)**: 
    *   成功提取了豪鬼的 **45 条**连段。
    *   数据结构十分清晰且完整，提取的内容涵盖：连段分类 (Day 1 BnBs, DI Combos 等)、连段指令、起始招式、伤害、位置、难度、超必杀/斗气消耗情况和备注。

### ⏳ 待完成的后续步骤 (Next Steps)

按照优先级排列，我们接下来需要进行以下工作：

#### 步骤 1：全角色连段数据爬取 (Batch Scraping Combos)
- 给其他现有数据完备的角色一并跑一次 `scripts/scraper-combos.ts`，充实 `src/data/combos` 下的数据文件。

#### 步骤 2：前端连段展示组件 (Combo UI Component)
- **分析现有 UI**: 查看当前的字符界面路由和展示逻辑 (`CharacterView.vue` 或新建专属页面)。
- **开发新组件 `ComboList.vue`**: 用以美观地渲染 JSON 中的连段数据。
- **添加筛选功能**: 比如按难度（Easy/Hard）、按启动方式（DI/PC）进行筛选或分类展示。

#### 步骤 3：核心招式推荐功能 (Key Moves Feature)
- 新增 "核心招式" (“Key Moves”) 的数据结构设计（可能只是一组记录了 Move Id 的列表和其上榜理由的描述）。
- 开发能够抓取此类信息的爬虫（从 Wiki 上的 Strategy/Overview 或 manually curated 数据源），或者通过脚本半自动从现有数据中提炼。
- 在前端角色总览处新增并高亮展示“核心招式”板块。

#### 步骤 4：Oki Calculator 集成 (Oki Calc Integration - 可选增强)
- 探索是否能在展示一条 Combo 时，提供一个快速按钮 "Send to Oki Calculator"，直接将这套连段的终结技推送到起身压制计算器中模拟压制套路。

---
*文档更新时间: 2026-03-16*
