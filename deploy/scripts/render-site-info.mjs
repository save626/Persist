/**
 * 把 deploy/site-info.json 里的合规信息注入到 landing 的两个单文件页面。
 *
 * 为什么要用脚本而不是直接改 HTML：备案号要等管局下发，是**后补**的。
 * 落到 HTML 里就得再改一次源码、重新上传；这里让 site-info.json 成为唯一
 * 来源，改一次 JSON 重跑一次脚本即可，两页永远一致。
 *
 * 规则：
 *   - icpNumber 为空 → 不渲染任何 ICP 编号
 *   - icpNumber 有值 → 渲染成链接到 beian.miit.gov.cn 的备案号
 *   - policeNumber 同理，链接到 beian.mps.gov.cn
 *   - 两者都为空 → 渲染「备案信息待下发」占位说明，绝不编造编号
 *
 * 锚点用 HTML 注释而不是属性值：渲染结果里含 href="..." 双引号，
 * 塞进属性会破坏属性边界；注释标记既能被正则精确定位，也能保证
 * 重复运行结果一致（幂等）。
 *
 * 用法：
 *   node deploy/scripts/render-site-info.mjs          # 写入 landing/*.html
 *   node deploy/scripts/render-site-info.mjs --check  # 只校验，不写入（CI 用）
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseSiteInfo, siteInfoRender } from './site-info-core.mjs'

const repoRoot = resolve(import.meta.dirname, '..', '..')
const siteInfoPath = resolve(repoRoot, 'deploy', 'site-info.json')

const TARGETS = [
  resolve(repoRoot, 'landing', 'index.html'),
  resolve(repoRoot, 'landing', 'home.html'),
]

/** 锚点：成对注释，中间的内容由本脚本重写。 */
const ANCHOR = /<!--site-info-->([\s\S]*?)<!--\/site-info-->/

const siteInfo = parseSiteInfo(JSON.parse(readFileSync(siteInfoPath, 'utf8')))

function renderLinks() {
  // 渲染逻辑与落地页的 Vue 组件共用 siteInfoRender —— 两边必须逐字节相同，
  // 否则 Vue hydrate 会报内容不匹配（见 site-info-core.mjs 的说明）。
  const rendered = siteInfoRender(siteInfo)
  return `<span class="${rendered.className}">${rendered.html}</span>`
}

const rendered = renderLinks()
const checkOnly = process.argv.includes('--check')
const failures = []

for (const file of TARGETS) {
  const original = readFileSync(file, 'utf8')
  if (!ANCHOR.test(original)) {
    failures.push(`${file} 里找不到 site-info 占位符`)
    continue
  }
  const next = original.replace(ANCHOR, `<!--site-info-->${rendered}<!--/site-info-->`)
  if (next === original) {
    continue
  }
  if (checkOnly) {
    failures.push(`${file} 的 site-info 与 site-info.json 不一致（需重跑脚本）`)
    continue
  }
  writeFileSync(file, next)
  console.log(`已更新 ${file}`)
}

if (checkOnly) {
  if (failures.length > 0) {
    console.error('校验失败：')
    for (const failure of failures) console.error(`  - ${failure}`)
    process.exit(1)
  }
  console.log('site-info 与 landing 页面一致。')
}
