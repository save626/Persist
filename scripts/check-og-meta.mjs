// 校验社交分享卡（OG / Twitter）标签。
//
// 为什么需要它：分享卡是「写在 <head> 里、靠爬虫抓」的产物 —— 标签写错、图片 404、
// 尺寸对不上，都不会在页面上报错，只会在真正分享时悄悄变成一张白卡。
// 这个脚本把「分享前该查的东西」收敛成一条只读命令。
//
// 用法：
//   node scripts/check-og-meta.mjs                        # 校验本地 landing/index.html 与 landing/home.html
//   node scripts/check-og-meta.mjs --url https://wpersist.top/   # 校验线上页面，并 HEAD 线上 og:image
//   node scripts/check-og-meta.mjs --url http://<ip>/ --no-head  # 线上页面但不请求图片
//   node scripts/check-og-meta.mjs --url http://<ip>/ --image-url http://<ip>/assets/og-card.png
//                                                      # 域名未解析时，用 IP 地址核对线上那张卡
//
// 退出码：0 = 通过（可能有告警）；1 = 有错误项。
//
// 硬约束（不通过即报错）：
//   · og:image / twitter:image 必须是绝对 URL
//   · og:image:width / height 必须是 1200 / 630，且与实际 PNG 尺寸一致
//   · twitter:card 必须是 summary_large_image（否则大图不展开）
//   · <head> 内不得出现任何备案编号 —— 备案号未下发，绝不编造
//
// 只读：不写任何文件，不改任何线上内容。

import { createHash } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const LOCAL_PAGES = [
  { label: 'landing/index.html', file: join(ROOT, 'landing', 'index.html') },
  { label: 'landing/home.html', file: join(ROOT, 'landing', 'home.html') },
]
const LOCAL_IMAGE = join(ROOT, 'landing', 'assets', 'og-card.png')

const EXPECT_W = 1200
const EXPECT_H = 630

const args = process.argv.slice(2)
const argOf = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const targetUrl = argOf('--url')
const imageUrlOverride = argOf('--image-url')
const skipHead = args.includes('--no-head')

const errors = []
const warnings = []
const err = (m) => errors.push(m)
const warn = (m) => warnings.push(m)

// ---------------------------------------------------------------- 解析

/** 从 HTML 里抽出 <head> 内的 meta / link 标签。 */
function parseHead(html) {
  const headMatch = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i)
  const head = headMatch ? headMatch[1] : html
  const tags = [...head.matchAll(/<(meta|link)\b[^>]*>/gi)].map((m) => m[0])

  const meta = {}
  for (const tag of tags) {
    if (!/^<meta\b/i.test(tag)) continue
    const key =
      attr(tag, 'property') ?? attr(tag, 'name')
    const content = attr(tag, 'content')
    if (key && content !== null && !(key in meta)) meta[key] = content
  }

  let canonical = null
  for (const tag of tags) {
    if (!/^<link\b/i.test(tag)) continue
    if ((attr(tag, 'rel') ?? '').toLowerCase().split(/\s+/).includes('canonical')) {
      canonical = attr(tag, 'href')
      break
    }
  }

  return { meta, canonical, headText: head }
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i'))
  return m ? m[1] : null
}

// ---------------------------------------------------------------- PNG 尺寸

function pngSize(buf) {
  if (buf.length < 24) return null
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  for (let i = 0; i < sig.length; i++) if (buf[i] !== sig[i]) return null
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

// ---------------------------------------------------------------- 校验

function checkMeta(label, meta, canonical) {
  const need = [
    'og:type',
    'og:site_name',
    'og:locale',
    'og:title',
    'og:description',
    'og:url',
    'og:image',
    'og:image:type',
    'og:image:width',
    'og:image:height',
    'og:image:alt',
    'twitter:card',
    'twitter:title',
    'twitter:description',
    'twitter:image',
  ]
  for (const key of need) {
    if (!meta[key]) err(`${label}：缺少 ${key}`)
  }

  if (meta['twitter:card'] && meta['twitter:card'] !== 'summary_large_image') {
    err(`${label}：twitter:card 应为 summary_large_image，实为 ${meta['twitter:card']}`)
  }

  for (const key of ['og:image', 'twitter:image']) {
    const v = meta[key]
    if (!v) continue
    if (!/^https?:\/\//i.test(v)) {
      err(`${label}：${key} 必须是绝对 URL，实为 ${v}`)
    }
  }

  if (meta['og:url'] && !/^https?:\/\//i.test(meta['og:url'])) {
    err(`${label}：og:url 必须是绝对 URL，实为 ${meta['og:url']}`)
  }

  if (canonical && !/^https?:\/\//i.test(canonical)) {
    err(`${label}：canonical 必须是绝对 URL，实为 ${canonical}`)
  }

  const w = Number(meta['og:image:width'])
  const h = Number(meta['og:image:height'])
  if (meta['og:image:width'] && w !== EXPECT_W) {
    err(`${label}：og:image:width 应为 ${EXPECT_W}，实为 ${meta['og:image:width']}`)
  }
  if (meta['og:image:height'] && h !== EXPECT_H) {
    err(`${label}：og:image:height 应为 ${EXPECT_H}，实为 ${meta['og:image:height']}`)
  }

  if (meta['og:image'] && meta['twitter:image'] && meta['og:image'] !== meta['twitter:image']) {
    err(`${label}：og:image 与 twitter:image 不一致（两端应指向同一张卡）`)
  }
}

/** <head> 内不得出现备案编号 —— 尚未下发，绝不编造。 */
function checkNoFakeIcp(label, headText) {
  const hit = headText.match(/ICP备[\dA-Za-z-]*|浙ICP|京ICP|沪ICP|粤ICP|苏ICP|鲁ICP/gi)
  if (hit) {
    err(`${label}：<head> 内出现疑似备案编号「${[...new Set(hit)].join('、')}」——未下发前不得出现`)
  }
}

// ---------------------------------------------------------------- 主流程

async function main() {
  console.log('=== 社交分享卡（OG）标签自检 ===\n')

  // 本地卡面
  let localSize = null
  let localSha = null
  if (existsSync(LOCAL_IMAGE)) {
    const buf = readFileSync(LOCAL_IMAGE)
    localSize = pngSize(buf)
    localSha = createHash('sha256').update(buf).digest('hex')
    if (!localSize) {
      err(`landing/assets/og-card.png 不是合法 PNG`)
    } else {
      if (localSize.width !== EXPECT_W || localSize.height !== EXPECT_H) {
        err(`landing/assets/og-card.png 实际 ${localSize.width}×${localSize.height}，应为 ${EXPECT_W}×${EXPECT_H}`)
      }
      console.log(
        `本地卡面 landing/assets/og-card.png：${localSize ? `${localSize.width}×${localSize.height}` : '?'} / ${buf.length} B / sha256 ${localSha.slice(0, 16)}…`,
      )
    }
  } else {
    warn('本地找不到 landing/assets/og-card.png，跳过卡面尺寸核对')
  }

  const pages = []

  if (targetUrl) {
    console.log(`\n线上页面：${targetUrl}`)
    let html
    try {
      const res = await fetch(targetUrl, { redirect: 'follow' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      html = await res.text()
      console.log(`  抓取成功（HTTP ${res.status}，${html.length} 字节）`)
    } catch (e) {
      err(`线上页面抓取失败：${e.message}`)
      html = null
    }
    if (html) {
      const { meta, canonical, headText } = parseHead(html)
      checkMeta('线上页面', meta, canonical)
      checkNoFakeIcp('线上页面', headText)
      pages.push({ label: '线上页面', meta, canonical })

      const imageToCheck = imageUrlOverride ?? meta['og:image']
      if (!skipHead && imageToCheck) {
        if (imageUrlOverride) {
          console.log(`  改用指定图片地址核对：${imageToCheck}`)
        }
        try {
          const r = await fetch(imageToCheck, { method: 'GET' })
          const buf = Buffer.from(await r.arrayBuffer())
          const size = pngSize(buf)
          console.log(
            `  og:image → HTTP ${r.status} / ${r.headers.get('content-type')} / ${buf.length} B` +
              (size ? ` / ${size.width}×${size.height}` : ''),
          )
          if (!r.ok) err(`og:image 取回失败：HTTP ${r.status}`)
          if ((r.headers.get('content-type') ?? '') !== 'image/png') {
            err(`og:image Content-Type 应为 image/png，实为 ${r.headers.get('content-type')}`)
          }
          if (size && (size.width !== EXPECT_W || size.height !== EXPECT_H)) {
            err(`线上 og:image 实际 ${size.width}×${size.height}，应为 ${EXPECT_W}×${EXPECT_H}`)
          }
          if (localSha && buf.length) {
            const remoteSha = createHash('sha256').update(buf).digest('hex')
            console.log(
              remoteSha === localSha
                ? '  与本地 landing/assets/og-card.png 逐字节一致'
                : '  与本地卡面不一致（本地尚未重新渲染 / 未部署）',
            )
          }
        } catch (e) {
          // 网络层失败（域名尚未解析 / 站点未上线）属于预期状态，不算错误项：
          // 爬虫此时同样抓不到这张卡，与「页面本身也不该对外」是同一道闸门。
          const reason = e.cause?.code ?? e.message
          const NET_UNREACHABLE = [
            'ENOTFOUND',
            'EAI_AGAIN',
            'ECONNREFUSED',
            'ETIMEDOUT',
            'EHOSTUNREACH',
            'UND_ERR_CONNECT_TIMEOUT',
            'UND_ERR_SOCKET',
          ]
          if (NET_UNREACHABLE.includes(reason)) {
            warn(
              `og:image 抓不到（${reason}）——${imageToCheck} 目前不可达。` +
                `备案号下发前这就是预期行为（爬虫此时也抓不到，与页面不对外是同一道闸门）；` +
                `若域名已上线，请把这条当故障排查。`,
            )
          } else {
            err(`og:image 请求失败：${e.message}`)
          }
        }
      }
    }
  } else {
    for (const { label, file } of LOCAL_PAGES) {
      if (!existsSync(file)) {
        err(`缺少 ${label}`)
        continue
      }
      const html = readFileSync(file, 'utf8')
      const { meta, canonical, headText } = parseHead(html)
      checkMeta(label, meta, canonical)
      checkNoFakeIcp(label, headText)
      pages.push({ label, meta, canonical })
    }
  }

  console.log('\n--- 抓到的标签 ---')
  for (const p of pages) {
    console.log(`\n[${p.label}]`)
    console.log(`  canonical     ${p.canonical ?? '(缺失)'}`)
    for (const k of [
      'og:type',
      'og:site_name',
      'og:locale',
      'og:title',
      'og:description',
      'og:url',
      'og:image',
      'og:image:type',
      'og:image:width',
      'og:image:height',
      'og:image:alt',
      'twitter:card',
      'twitter:title',
      'twitter:description',
      'twitter:image',
    ]) {
      if (p.meta[k] !== undefined) console.log(`  ${k.padEnd(14)} ${p.meta[k]}`)
    }
  }

  console.log('')
  for (const w of warnings) console.log(`⚠ 告警：${w}`)
  for (const e of errors) console.log(`✗ 错误：${e}`)

  if (errors.length) {
    console.log(`\n结果：不通过（${errors.length} 个错误，${warnings.length} 个告警）`)
    process.exit(1)
  }
  console.log(`\n结果：通过（${warnings.length} 个告警）`)
}

await main()
