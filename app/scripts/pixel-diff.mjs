// 基线像素对拍：visual:check 只查 overflow / console error / 缺元素，不看像素。
// 这个脚本补上那一环——把两张同尺寸 PNG 送进浏览器 canvas 比较，输出差异像素数与
// 差异包围盒，并把差异可视化落到 /tmp。
//
// 用法：
//   node scripts/pixel-diff.mjs ../design /tmp/vis-base            # 比对同名文件
//   node scripts/pixel-diff.mjs ../design /tmp/vis-base study-tablet-500.png
import { chromium } from 'playwright'
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join, basename } from 'node:path'

const [, , dirA = '../design', dirB = '/tmp/vis-base', ...only] = process.argv

/** 单个通道差值超过该阈值才算“不同”，避开 PNG 重编码带来的 ±1 抖动。 */
const CHANNEL_TOLERANCE = 6

if (!existsSync(dirA) || !existsSync(dirB)) {
  console.error(`目录不存在：${dirA} / ${dirB}`)
  process.exit(1)
}

const names = only.length
  ? only
  : readdirSync(dirA)
      .filter((name) => name.endsWith('.png'))
      .sort()

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
await page.setContent('<html><body></body></html>')

const rows = []
for (const name of names) {
  const aPath = join(dirA, name)
  const bPath = join(dirB, name)
  if (!existsSync(aPath) || !existsSync(bPath)) {
    rows.push({ name, status: 'missing' })
    continue
  }
  const a = 'data:image/png;base64,' + readFileSync(aPath).toString('base64')
  const b = 'data:image/png;base64,' + readFileSync(bPath).toString('base64')

  const result = await page.evaluate(
    async ({ a, b, tolerance }) => {
      const load = async (src) => {
        const bitmap = await fetch(src).then((response) => response.blob())
        return createImageBitmap(bitmap)
      }
      const [ia, ib] = await Promise.all([load(a), load(b)])
      if (ia.width !== ib.width || ia.height !== ib.height) {
        return {
          sizeMismatch: `${ia.width}x${ia.height} vs ${ib.width}x${ib.height}`,
          diffPixels: -1,
        }
      }
      const canvasA = new OffscreenCanvas(ia.width, ia.height)
      const canvasB = new OffscreenCanvas(ib.width, ib.height)
      const ctxA = canvasA.getContext('2d')
      const ctxB = canvasB.getContext('2d')
      ctxA.drawImage(ia, 0, 0)
      ctxB.drawImage(ib, 0, 0)
      const dataA = ctxA.getImageData(0, 0, ia.width, ia.height).data
      const dataB = ctxB.getImageData(0, 0, ib.width, ib.height).data

      const out = new ImageData(ia.width, ia.height)
      const outData = out.data
      let diffPixels = 0
      let minX = Infinity
      let minY = Infinity
      let maxX = -1
      let maxY = -1
      // 逐行统计，便于定位“差异集中在哪几段高度上”。
      const rowDiff = new Array(ia.height).fill(0)
      for (let y = 0; y < ia.height; y += 1) {
        for (let x = 0; x < ia.width; x += 1) {
          const index = (y * ia.width + x) * 4
          const dr = Math.abs(dataA[index] - dataB[index])
          const dg = Math.abs(dataA[index + 1] - dataB[index + 1])
          const db = Math.abs(dataA[index + 2] - dataB[index + 2])
          const max = Math.max(dr, dg, db)
          if (max > tolerance) {
            diffPixels += 1
            rowDiff[y] += 1
            if (x < minX) minX = x
            if (x > maxX) maxX = x
            if (y < minY) minY = y
            if (y > maxY) maxY = y
            outData[index] = 255
            outData[index + 1] = 0
            outData[index + 2] = 0
            outData[index + 3] = 255
          } else {
            // 变暗原图，红色标记才看得清。
            outData[index] = dataB[index] * 0.25
            outData[index + 1] = dataB[index + 1] * 0.25
            outData[index + 2] = dataB[index + 2] * 0.25
            outData[index + 3] = 255
          }
        }
      }
      // 差异成段：把连续有差异的行压成区间，最多报 5 段。
      const bands = []
      let start = -1
      for (let y = 0; y <= ia.height; y += 1) {
        const hot = y < ia.height && rowDiff[y] > 0
        if (hot && start < 0) start = y
        if (!hot && start >= 0) {
          bands.push([start, y - 1])
          start = -1
        }
      }
      const canvas = document.createElement('canvas')
      canvas.width = ia.width
      canvas.height = ia.height
      canvas.getContext('2d').putImageData(out, 0, 0)
      return {
        diffPixels,
        total: ia.width * ia.height,
        bbox: maxX >= 0 ? { minX, minY, maxX, maxY } : null,
        bands: bands.slice(0, 5),
        bandCount: bands.length,
        png: canvas.toDataURL('image/png'),
      }
    },
    { a, b, tolerance: CHANNEL_TOLERANCE },
  )

  if (result.sizeMismatch) {
    rows.push({ name, status: 'size', detail: result.sizeMismatch })
    continue
  }
  if (result.png) {
    writeFileSync(
      `/tmp/pixel-diff-${basename(name, '.png')}.png`,
      Buffer.from(result.png.split(',')[1], 'base64'),
    )
  }
  rows.push({ name, status: result.diffPixels === 0 ? 'same' : 'diff', ...result, png: undefined })
}

await browser.close()

const same = rows.filter((row) => row.status === 'same').length
const diff = rows.filter((row) => row.status === 'diff')
for (const row of diff) {
  const pct = ((row.diffPixels / row.total) * 100).toFixed(2)
  console.log(
    `DIFF ${row.name}  ${row.diffPixels}px (${pct}%)  区域 ${JSON.stringify(row.bbox)}  段数 ${row.bandCount} ${JSON.stringify(row.bands)}`,
  )
}
for (const row of rows.filter((r) => r.status !== 'same' && r.status !== 'diff')) {
  console.log(`${row.status.toUpperCase()} ${row.name} ${row.detail ?? ''}`)
}
console.log(`\n合计 ${rows.length} 张：相同 ${same}、不同 ${diff.length}`)
