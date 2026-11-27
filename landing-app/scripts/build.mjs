/**
 * 构建落地页单文件：Vue3 SFC → SSR 预渲染静态 HTML → 组装回 landing/index.html
 *
 * 流程：
 *   1. Vite SSR：把 App.vue 渲染成静态 HTML（无 JS 时完整可读）
 *   2. Vite client：把 main.js + Vue 打包成单 IIFE + CSS
 *   3. 读取 vendored 引擎源码（third_party/.../engine.js），原样内联；
 *      读取星空底图 data URI（src/three/starfield.datauri.txt）注入 CSS 变量
 *   4. 组装：head（meta/OG 原样保留）+ CSS（含星空变量）+ 静态 HTML + 引擎 + 客户端 JS
 *   5. 写入 landing/index.html；--check 时只校验产物存在与体积
 *
 * 为什么要 SSR：验收要求「关掉 JS 后内容完整可读」。纯客户端渲染会空白，
 * 所以构建期先渲染出静态 HTML，运行时 Vue hydrate 接管交互。
 *
 * 为什么要保留 head：OG meta / canonical / site-info 占位符由其它验收脚本核对，
 * 必须从旧页面逐字保留。
 */
import { build, createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { readFileSync, writeFileSync, existsSync, statSync, cpSync, readdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseSiteInfo, siteInfoRender } from '../../deploy/scripts/site-info-core.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REPO = resolve(ROOT, '..')
const OUT = resolve(REPO, 'landing', 'index.html')
const ENGINE = resolve(REPO, 'third_party', 'eyetutorial-replica', 'engine.js')
const HEAD_TPL = resolve(ROOT, 'scripts', 'head.html')
const CHECK = process.argv.includes('--check')

// 网站合规信息（ICP / 公安备案号）。唯一来源 deploy/site-info.json，
// 与 React 端（app/vite.config.ts）共用同一份数据、同一套渲染函数。
//
// 为什么要构建期内联而不是「构建完再改 HTML」：
// 事后改静态 HTML 会让 SSR 产物与客户端渲染不一致——Vue hydrate 直接报
// 「Hydration completed but contains mismatches」，check-landing 必红。
// 所以这里把渲染结果 define 进两端（SSR 与 client 用同一份字符串），
// 保证逐字节一致；deploy/scripts/render-site-info.mjs 退化为校验器。
const siteInfo = parseSiteInfo(
  JSON.parse(readFileSync(resolve(REPO, 'deploy', 'site-info.json'), 'utf8')),
)
const siteInfoDefine = { __SITE_INFO_RENDER__: JSON.stringify(siteInfoRender(siteInfo)) }

if (CHECK) {
  if (!existsSync(OUT)) {
    console.error('产物不存在：' + OUT)
    process.exit(1)
  }
  const s = statSync(OUT)
  console.log(`landing/index.html 存在：${s.size} B`)
  process.exit(0)
}

// ---------- 1. SSR 预渲染 ----------
// 粒子舞台复用仓库内的融合工程（同一份着色器/场景代码，不复制一份到 landing-app）
const FUSION_SRC = resolve(ROOT, '..', 'gesture-particle-fusion-20261121', 'src')
const alias = { '@fusion': FUSION_SRC }

const ssrServer = await createServer({
  root: ROOT,
  configFile: false,
  logLevel: 'warn',
  plugins: [vue()],
  resolve: { alias },
  define: siteInfoDefine,
  server: { middlewareMode: true, hmr: false },
  appType: 'custom',
})
let appHtml
try {
  const mod = await ssrServer.ssrLoadModule('/src/entry-server.js')
  appHtml = await mod.render()
} finally {
  await ssrServer.close()
}

// ---------- 2. 客户端打包 ----------
await build({
  root: ROOT,
  configFile: false,
  logLevel: 'warn',
  plugins: [vue()],
  resolve: { alias },
  define: siteInfoDefine,
  build: {
    outDir: resolve(ROOT, 'dist'),
    emptyOutDir: true,
    cssCodeSplit: false,
    // IIFE 单文件：关掉 modulePreload，避免动态 import 被注入 import.meta.url 的预加载 helper
    modulePreload: false,
    write: true,
    rollupOptions: {
      input: resolve(ROOT, 'src/main.js'),
      output: {
        format: 'iife',
        name: 'PersistLanding',
        inlineDynamicImports: true,
        entryFileNames: 'app.js',
        assetFileNames: 'app.[ext]',
      },
    },
  },
})

const appJs = readFileSync(resolve(ROOT, 'dist', 'app.js'), 'utf8')
const appCss = readFileSync(resolve(ROOT, 'dist', 'app.css'), 'utf8')
const engine = readFileSync(ENGINE, 'utf8').replace(/\r\n/g, '\n')
const head = readFileSync(HEAD_TPL, 'utf8').replace(/\r\n/g, '\n')

// 2026-11-23：星空照片底图整层删除（用户要求只留流星层与星轨），
// 不再注入 --intro-starfield —— 单这一项就省掉 2 008 386 字符的 data URI。
// src/three/starfield.datauri.txt 仍留在仓库（255 KB 的文本，2 MB 图片的逐字节 base64），
// 只作为「要恢复底图」时的素材；恢复步骤：把 div.intro-sky 加回模板 + 这里重新注入 + 恢复 CSS。

// ---------- 3. 组装 ----------
const html = `${head}
<style>
${appCss}
</style>
</head>
<body>
<!-- Vue SSR 预渲染：无 JS 时完整可读；有 JS 时 hydrate 接管 -->
<div id="app">${appHtml}</div>

<!-- ===== 内联：third_party/eyetutorial-replica/engine.js（勿手改，见 scripts/inline-intro-engine.mjs） ===== -->
<script>
${engine}
</script>
<!-- ===== 内联结束 ===== -->

<script>
${appJs}
</script>
</body>
</html>
`

writeFileSync(OUT, html.replace(/\r\n/g, '\n'))
console.log(`已生成 ${OUT}（${Buffer.byteLength(html)} B）`)

// ---------- 4. 手势资源：同源静态目录 ----------
// 开场里的「开启手势」要 MediaPipe：wasm + 模型无法塞进单文件（约 22 MB），
// 所以按目录同源提供，运行时由 HandTracker({ base: './fusion/mediapipe' }) 取。
// 代价（必须写进文档）：这一版不再「单文件可双击打开」，手势也只在 http(s) 下可用；
// 不点「开启手势」就不会请求这些文件，也不申请摄像头。
const FUSION_MP = resolve(REPO, 'gesture-particle-fusion-20261121', 'vendor', 'mediapipe')
const LANDING_MP = resolve(REPO, 'landing', 'fusion', 'mediapipe')
if (existsSync(FUSION_MP)) {
  cpSync(FUSION_MP, LANDING_MP, { recursive: true })
  const bytes = readdirBytes(LANDING_MP)
  console.log(`已同步手势资源 ${LANDING_MP}（${(bytes / 1048576).toFixed(1)} MB）`)
} else {
  console.warn('⚠ 未找到 fusion vendor/mediapipe，跳过手势资源同步（开场的手势按钮会报缺文件）')
}

function readdirBytes(dir) {
  let total = 0
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = resolve(dir, e.name)
    total += e.isDirectory() ? readdirBytes(p) : statSync(p).size
  }
  return total
}
