# 项目 Agent 指南

## 更新 SuperCombo 角色帧数数据

### 工作方式与范围

- 优先复用现有 Puppeteer 和抓取脚本，不另写爬虫或安装新的浏览器工具。
- Agent 可能运行在 WSL2；直接请求 SuperCombo 或自行启动浏览器可能遇到 Cloudflare 验证。默认由用户在 **Windows 宿主机**启动带远程调试的 Chrome、打开目标页面并手动完成验证，再由 Agent 通过 CDP 连接读取页面。
- 用户要求更新数据或测试抓取链路时，可以连接该调试浏览器。其他任务仍遵守“除非用户明确要求，否则不要使用浏览器”。
- 用户已启动 Chrome、打开页面时，先检查现有连接，不要要求重复启动。只测试链路时，只读页面，不执行会写入角色 JSON 的完整抓取脚本。
- 仅处理用户指定的角色；不要省略角色参数而意外更新所有角色。

### 1. 指导用户准备宿主机 Chrome

调试端口不可用时，说明需要用户在 Windows 上启动独立调试会话。Windows **CMD** 命令：

```bat
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="C:/ChromeDevSession"
```

Windows **PowerShell** 命令需要前置 `&`：

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="C:/ChromeDevSession"
```

让用户在这个 Chrome 窗口中打开目标角色的 `/Frame_data` 页面，例如 Luke：

```text
https://wiki.supercombo.gg/w/Street_Fighter_6/Luke/Frame_data
```

其他角色的基础 URL 和角色 ID 以 `scripts/characters.ts` 为准，在 `wikiUrl` 后追加 `/Frame_data`，不要猜测角色名中的空格或标点。请用户手动完成 Cloudflare 验证，等到出现包含 `Startup`、`Active`、`Recovery` 的帧数表格，并保持标签页打开。

如果命令没有启用调试端口，先排查是否已有使用 `C:/ChromeDevSession` 的 Chrome 进程，必要时请用户关闭该调试会话后重新启动；不要自动结束所有 Chrome 进程或删除用户配置目录。

### 2. Agent 先检查 CDP 和页面内容

先在 Agent 所在环境运行：

```bash
curl --noproxy '*' --connect-timeout 3 --max-time 5 --fail --silent --show-error http://localhost:9222/json/version
```

返回 Chrome 版本和 `webSocketDebuggerUrl`，仅说明调试端口可达；还需要确认 WebSocket 连接和实际帧数内容。复用项目已安装的 Puppeteer 做只读检查（下面以 Luke 为例，其他角色替换 `targetUrl`）：

```bash
CDP_HOST=localhost node --input-type=module <<'JS'
import puppeteer from 'puppeteer';

const targetUrl = 'https://wiki.supercombo.gg/w/Street_Fighter_6/Luke/Frame_data';
let browser;
try {
  browser = await puppeteer.connect({
    browserURL: `http://${process.env.CDP_HOST || 'localhost'}:9222`,
    defaultViewport: null,
  });
  const normalize = value => {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`.replace(/\/+$/, '').toLowerCase();
  };
  const page = (await browser.pages()).find(p => normalize(p.url()) === normalize(targetUrl));
  if (!page) throw new Error(`请用户在调试 Chrome 中打开 ${targetUrl}`);
  const result = await page.evaluate(() => {
    const tables = Array.from(document.querySelectorAll('table')).filter(table => {
      const headers = Array.from(table.querySelectorAll('th')).map(th => th.textContent).join(' ');
      return /startup/i.test(headers) && /active/i.test(headers) && /recovery/i.test(headers);
    });
    return {
      url: location.href,
      title: document.title,
      frameTableCount: tables.length,
      frameRowCount: tables.reduce((count, table) => count +
        Array.from(table.querySelectorAll('tr')).filter(row => row.querySelector('td')).length, 0),
      sample: tables[0] ? Array.from(tables[0].querySelectorAll('tr'))
        .find(row => row.querySelector('td'))?.innerText : null,
    };
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.frameRowCount || /just a moment|attention required|security verification/i.test(result.title)) {
    throw new Error('尚未读到有效帧数数据，请用户检查页面加载或完成 Cloudflare 验证');
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  if (browser) browser.disconnect();
}
JS
```

检查完只调用 `browser.disconnect()`，保持用户的浏览器和标签页打开。不要用 `browser.close()` 结束宿主机 Chrome。连接成功、找到目标页面且读取到实际帧数行后，才能报告链路已验证。

### 3. WSL2 连接失败时的排查顺序

- `localhost` 失败时再试 `127.0.0.1`，不要假设所有 WSL2 环境都能通过回环地址访问 Windows。
- 请用户在 Windows PowerShell 执行 `curl.exe --noproxy "*" http://127.0.0.1:9222/json/version`。Windows 上也失败时，先解决 Chrome 启动参数或调试会话问题。
- Windows 上成功、WSL2 中失败时，检查 WSL 网络模式和宿主机地址。`ip route show default` 可提供候选网关；也可请用户通过 Windows `ipconfig` 确认地址。不要把 `/etc/resolv.conf` 的 DNS 地址直接当作宿主机地址。
- 用同样的 `curl` 检查 `http://<WINDOWS_IP>:9222/json/version`，再将上面只读检查中的 `CDP_HOST` 改为已验证的地址。如果 HTTP 可达但 Puppeteer 连接失败，继续检查 `webSocketDebuggerUrl` 的地址是否从 WSL 可达，不能把 HTTP 成功当作完整链路成功。
- 如果 Chrome 只监听 Windows 回环地址，单独添加 `--host` 并不能解决问题；需要由用户按实际网络配置提供 WSL 到该回环端口的转发或隧道，并检查相应防火墙规则。不要自动关闭防火墙或把调试端口暴露到公网。
- 页面仍显示验证页或没有帧数行时，请用户在同一个调试窗口完成验证、打开正确页面；不要反复启动新浏览器、请求目标站点或尝试自动处理验证码。

向用户报告具体失败阶段（调试端口 / WebSocket / 目标标签页 / 表格内容）和下一步需要的操作。无法读取实际数据时标记为“未验证”或“失败”。

### 4. 用户要求更新数据时执行现有脚本

先检查 Git 状态，记录已有改动；目标 JSON 已有用户改动时，先保护这些改动，避免直接覆盖。完成上述链路检查后，针对 `/Frame_data` 页面使用：

```bash
# 单角色更新；角色 ID 在前，避免被 --host 的参数解析影响
pnpm exec tsx scripts/scraper-puppeteer-frame-data.ts luke --connect

# 需要指定宿主机地址时，替换 <WINDOWS_IP>
pnpm exec tsx scripts/scraper-puppeteer-frame-data.ts luke --connect --host <WINDOWS_IP>
```

- 该脚本优先复用 URL 匹配的现有 `/Frame_data` 标签页；未找到时会打开新页。不要将角色主页脚本 `scripts/scraper-puppeteer.ts` 与 `/Frame_data` 脚本混用。
- 只测试链路时不要运行上述更新命令：它会写入 `src/data/characters/<角色ID>.json`，当前没有 `--dry-run` 参数。
- 脚本遇到验证页时可能输出 `ACTION REQUIRED` 并无限等待。及时提示用户操作；不要把等待或进程退出当作更新成功。脚本可能捕获错误后继续，需要检查 `Failed to scrape`、`No moves found` 和实际输出。
- 仅在用户要求批量更新时才考虑省略角色参数。当前参数解析会把 `--host` 后的地址误认成角色；指定宿主机地址的批量任务应逐角色执行带角色 ID 的命令。
- 更新后检查对应 JSON 能否解析、角色 ID 和招式数量、代表招式的帧数字段，以及 Git diff 中的异常删除或空值；核对原有 `nameZh`、`noMeaty` 等人工补充字段是否保留。
- 按最小充分验证执行检查。仅更新说明或只读链路测试不需要全量测试、Build、部署或应用 E2E。最终说明链路和数据写入分别验证到了哪一步，以及 Git 是否暂存或提交。
