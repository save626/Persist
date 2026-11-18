// 真机 AI 探针：在设备 WebView 里用本机 pst_ 令牌真实打一次 /api/chat，只回传聚合结果
// （状态码、帧类型集合、是否有 done/error、字符数），令牌本身不打印。
//
// 为什么需要它：同源的 web 前端看不到跨源问题，只有 APK 里 origin 是 https://localhost
// 时才暴露。2026-11-18 就是靠这个探针发现 SSE 的 hijack 响应缺 CORS 头——浏览器直接
// `TypeError: Failed to fetch`，对话流一个字节都读不到。
//
// 用法：
//   adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>
//   node scripts/device-ai-probe.mjs                       # 默认打生产地址
//   PERSIST_API_BASE=http://127.0.0.1:3000 ...             # 需要时改目标
import { chromium } from "../app/node_modules/playwright-core/index.mjs";

const ENDPOINT = process.env.CDP_ENDPOINT ?? "http://127.0.0.1:9222";
const API = process.env.PERSIST_API_BASE ?? "http://121.196.39.123";

const profile = {
  age: 30,
  height: 175,
  weight: 72,
  targetWeight: 68,
  goal: "减脂",
  experience: "",
  frequency: "每周 3 次",
  equipment: "居家哑铃",
  dietPreference: "",
  allergies: "",
  bedtime: "",
  sleepHours: 7,
  stress: "",
  aiConsent: true,
};

const browser = await chromium.connectOverCDP(ENDPOINT);
const page = browser.contexts().flatMap((c) => c.pages())[0];
if (!page) throw new Error("没有可用页面");

const result = await page.evaluate(
  async ({ api, profile }) => {
    const openDb = () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open("persist-sync", 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    const db = await openDb();
    const meta = await new Promise((resolve, reject) => {
      const tx = db.transaction("meta", "readonly");
      const query = tx.objectStore("meta").get("persist-sync-meta");
      query.onsuccess = () => resolve(query.result);
      query.onerror = () => reject(query.error);
    });
    db.close();
    if (!meta?.token) return { error: "设备上没有同步令牌" };

    const startedAt = Date.now();
    const response = await fetch(`${api}/api/chat`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${meta.token}`,
      },
      body: JSON.stringify({
        turns: [
          {
            role: "user",
            content: "我想减脂，每周练 3 次，家里有哑铃，帮我看看怎么安排。",
          },
        ],
        profile,
      }),
    });
    const text = await response.text();
    const frames = text
      .split("\n\n")
      .filter((chunk) => chunk.startsWith("data: "))
      .map((chunk) => {
        try {
          return JSON.parse(chunk.slice(6));
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    return {
      status: response.status,
      elapsedMs: Date.now() - startedAt,
      bytes: text.length,
      frameCount: frames.length,
      frameTypes: [...new Set(frames.map((frame) => frame.type))],
      usageFrames: frames.filter((frame) => frame.type === "usage").length,
      hasDone: frames.some((frame) => frame.type === "done"),
      errorFrame: frames.find((frame) => frame.type === "error") ?? null,
      deltaChars: frames
        .filter((frame) => frame.type === "delta")
        .reduce((total, frame) => total + frame.text.length, 0),
      tokenPrefix: `${meta.token.slice(0, 4)}…${meta.token.slice(-4)}`,
      enabled: meta.enabled,
    };
  },
  { api: API, profile },
);

console.log(JSON.stringify(result, null, 2));
await browser.close();
