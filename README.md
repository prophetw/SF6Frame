# SF6Frame Data Tool

A Street Fighter 6 frame data and Oki calculator tool built with Vue 3 + TypeScript.

## Features
- **Frame Data**: View detailed frame data for SF6 characters.
- **Oki Calculator**: Calculate safe jump and pressure setups (Meaty).
- **Loop Throw Calculator**: Calculate precise meaty throw timings, including support for opponent abare (attack startup).

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
