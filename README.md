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
