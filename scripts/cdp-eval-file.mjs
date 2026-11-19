// 真机 WebView 助手：执行一个 JS 文件里的表达式（避免 shell 转义地狱）。
// 用法：node scripts/cdp-eval-file.mjs <脚本.js>
import { chromium } from "../app/node_modules/playwright-core/index.mjs";
import { readFile } from "node:fs/promises";

const ENDPOINT = process.env.CDP_ENDPOINT ?? "http://127.0.0.1:9222";
const file = process.argv[2];
if (!file) throw new Error("用法: node scripts/cdp-eval-file.mjs <脚本.js>");

const source = await readFile(file, "utf8");
const browser = await chromium.connectOverCDP(ENDPOINT);
const pages = browser.contexts().flatMap((c) => c.pages());
if (!pages.length)
  throw new Error("没有可用的页面，确认 adb forward 与 WebView 已启动");
const page = pages[0];
try {
  const value = await page.evaluate(`(async () => { ${source} })()`);
  console.log(JSON.stringify(value, null, 2));
} finally {
  await browser.close();
}
