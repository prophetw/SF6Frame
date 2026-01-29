# SF6Frame Data Tool

A Street Fighter 6 frame data and Oki calculator tool built with Vue 3 + TypeScript.

## Features
- **Frame Data**: View detailed frame data for SF6 characters.
- **Oki Calculator**: Calculate safe jump and pressure setups (Meaty).
- **Loop Throw Calculator**: Calculate precise meaty throw timings, including support for opponent abare (attack startup).

## Oki 压起身算法说明（当前实现）

本工具对“压起身”的判断不是只看对手**反击判定第一帧**，而是看我方打击帧是否覆盖对手**起身到反击判定前**的可命中窗口。

### 关键定义

- **击倒优势 N**：对手起身前的无敌帧数（例如 38F）。
- **对手反击起手 R**：反击招式从输入到**伤害判定第一帧**的帧数（例如 4F）。

由此得到：

- **对手起身可命中首帧** = `N + 1`
- **对手反击判定第一帧** = `N + R`
- **对手可命中窗口** = `[N + 1, N + R - 1]`  
  （若 `R <= 1`，窗口为空，只有可能相杀）

### 我方打击帧计算

组合链计算中会先累加前置动作帧数：

- **Dash** 等动作：直接累加其全帧数
- **招式**：若是组合链最后一段，则只累加其**发生（Startup）**，并记录其**持续（Active）**帧数

得到：

- **我方打击帧范围** = `[ourStart, ourEnd]`
- `ourStart` = 前置总帧 + 最后招式 Startup
- `ourEnd` = `ourStart + Active - 1`

### 判定逻辑

- **压制成功**：`[ourStart, ourEnd]` 与 **对手可命中窗口** 有重叠  
- **相杀**：不覆盖可命中窗口，但与 **对手反击判定第一帧**重合  
- **打击太早**：`ourEnd < (N + 1)`  
- **打击太晚**：其余情况

### 示例

击倒优势 `N = 38F`，对手反击 `R = 4F`：

- 对手起身可命中首帧 = `39F`
- 对手反击判定第一帧 = `42F`
- 可命中窗口 = `39~41F`

因此，只要我方打击帧覆盖 **39~41F** 任意一帧即可判定为**压制成功**。  
若只在 **42F** 与对手判定第一帧重合，则判定为**相杀**。

## Oki 循环投算法说明（当前实现）

目标：让投的**第一帧判定**压在对手起身后、刚能被投的那一帧（或安全窗口内）。

### 关键定义

- **击倒优势 N**：例如 38F。
- **起身投无敌 I**：对手起身自带的对投无敌时间（SF6通常为1F）。
- **投起手 S**：普通投发生（5F）。
- **投持续 A**：普通投持续（3F）。
- **对手抢招发生 R**：对手起床最短反击技发生（例如4F）。

### 可投窗口计算

1. **最早可投帧 (Earliest)**  
   对手起身第1帧通常有投无敌 `I`。  
   `Earliest = N + I + 1`  
   （例：38F击倒，1F投无敌 → 第40F可被投）

2. **最晚可投帧 (Latest)**  
   若对手抢招 `R`，我们需要在其判定生效前把它投掉。  
   `Latest = N + R - 1`  
   （例：对手4F抢招，判定在第 4F 生效，故需在判定生效前（第3F或更早）完成投）。  
   
   *注意*：如果对手不动（R=0），或者算出的 Latest < Earliest，则取 Earliest（即必须压起身第一帧）。

### 延迟帧数计算 (Delay)

我们希望通过 **前置动作 + 等待(Delay)** 来精确压起身。

- **最大延迟 (Max Delay - 晚压)**  
  让投的**第一帧持续**刚好打在 **Latest** 上。  
  `Delay = Latest - S`

- **最小延迟 (Min Delay - 早压)**  
  让投的**最后一帧持续**刚好打在 **Earliest** 上。  
  `Delay = Earliest - A + 1 - S`

- **判定**  
  如果 `前置动作耗时` 落在 `[Min Delay, Max Delay]` 区间内，说明可以直接投（或加细微微调）。  
  如果 `前置 + 填充技` 落在区间内，则该填充技可用。

## 🚀 Deployment

This project is configured to automatically deploy to **GitHub Pages** using GitHub Actions.

### How it works

1. **Trigger**: The workflow is triggered on every push to the `main` branch.
2. **Build**: GitHub Actions installs dependencies (`pnpm install`) and builds the project (`pnpm build`).
3. **Deploy**: The built artifacts in the `dist` folder are uploaded and deployed to GitHub Pages.

### Configuration
- Workflow file: `.github/workflows/deploy.yml`
- Base URL: Configured in `vite.config.ts` as `base: '/SF6Frame/'` (matching the repository name).

### Manual Trigger
You can also manually trigger the deployment from the [Actions tab](https://github.com/prophetw/SF6Frame/actions) on GitHub if needed.

## Development

```bash
# Install dependencies
pnpm install

# Start dev server
pnpm dev

# Build for production
pnpm build
```

### Update Data (数据更新)

Prerequisites:
1. Close all running Chrome instances.
2. Launch Chrome with remote debugging enabled from your terminal:
   ```bash
   "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="C:/ChromeDevSession"
   ```
   *(Ensure the port is 9222 and user-data-dir is set to preserve login sessions/settings)*

Commands:

```bash
# Update a single character (e.g., Ryu)
pnpm exec tsx scripts/scraper-puppeteer.ts ryu --connect

# Update ALL characters (Batch)
# 批量更新所有角色
pnpm exec tsx scripts/scraper-puppeteer.ts --connect
```