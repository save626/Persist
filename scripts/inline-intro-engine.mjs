/**
 * 把 third_party/eyetutorial-replica/engine.js 内联进 landing/index.html。
 *
 * 为什么要有这个脚本（而不是直接 <script src>）：
 *   落地页是**单文件**、零外部请求 —— 这是硬约束（见 landing/README.md §8）。
 *   直接引外部文件会破坏它，也会让 file:// 双击打开时多一次请求。
 *
 * 引擎是 vendored 的第三方代码（逐字节复制自源工程），所以它必须**原样内联**，
 * 不能手改。一旦手改，就和 third_party/ 里的「事实源」脱节了。
 *   → 本脚本只做「原样搬运 + 包裹」，一个字都不改引擎源码。
 *
 * 引擎原本是 IIFE，挂到 window.EyeEngine。内联时包一层 <script> 即可。
 *
 * 用法：
 *   node scripts/inline-intro-engine.mjs          # 写入 landing/index.html
 *   node scripts/inline-intro-engine.mjs --check  # 只校验（CI 用）
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ENGINE = resolve(ROOT, 'third_party', 'eyetutorial-replica', 'engine.js')
const PAGE = resolve(ROOT, 'landing', 'index.html')
const CHECK = process.argv.includes('--check')

/** 内联块的起止标记。改引擎时不需要动这里 —— 重跑脚本即可。 */
const BEGIN = '<!-- ===== 内联：third_party/eyetutorial-replica/engine.js（勿手改，见 scripts/inline-intro-engine.mjs） ===== -->'
const END = '<!-- ===== 内联结束 ===== -->'

if (!existsSync(ENGINE)) {
  console.error(`引擎不存在：${ENGINE}`)
  process.exit(1)
}
if (!existsSync(PAGE)) {
  console.error(`落地页不存在：${PAGE}`)
  process.exit(1)
}

const engine = readFileSync(ENGINE, 'utf8').replace(/\r\n/g, '\n')
const page = readFileSync(PAGE, 'utf8').replace(/\r\n/g, '\n')

const beginIdx = page.indexOf(BEGIN)
const endIdx = page.indexOf(END)

let next
if (beginIdx === -1 || endIdx === -1) {
  // 尚未内联：插到最后一个 <script> 之前（播放器需要 window.EyeEngine）
  const anchor = page.lastIndexOf('<script>')
  if (anchor === -1) {
    console.error('落地页里找不到 <script> 锚点')
    process.exit(1)
  }
  const block = `${BEGIN}\n<script>\n${engine}\n</script>\n${END}\n\n`
  next = page.slice(0, anchor) + block + page.slice(anchor)
} else {
  // 已有内联块：整块替换
  const head = page.slice(0, beginIdx)
  const tail = page.slice(endIdx + END.length)
  const block = `${BEGIN}\n<script>\n${engine}\n</script>\n${END}`
  next = head + block + tail
}

if (CHECK) {
  if (next === page) {
    console.log('✓ 内联块与 third_party 源文件一致')
    process.exit(0)
  }
  console.error('✗ 内联块与 third_party 源文件不一致 —— 请重跑：node scripts/inline-intro-engine.mjs')
  process.exit(1)
}

if (next !== page) {
  writeFileSync(PAGE, next, 'utf8')
  console.log(`已内联引擎（${engine.length} B）到 landing/index.html`)
} else {
  console.log('内联块已是最新，无需改动')
}
