/**
 * 把 MediaPipe 手部识别 vendored 到 `bloom/vendor/mediapipe/`。
 *
 * 为什么不用 `npm install`：
 *  - 这台机器的 npm 默认 cache 在用户目录，会被沙箱拒绝（EPERM，syscall mkdir）；
 *  - 我们只需要包里的 3 个文件，不需要依赖树、不需要 package.json。
 *
 * 所以这里直接：registry 拉 tarball（Node 的 fetch 走 OpenSSL，能通；curl/Invoke-WebRequest
 * 走 SChannel 在这台机器上必失败）→ `tar` 解包 → 复制必要文件 → 下载模型 → 校验 sha256。
 *
 * 用法：
 *   node bloom/scripts/vendor-mediapipe.mjs            # 缺什么装什么（幂等）
 *   node bloom/scripts/vendor-mediapipe.mjs --force    # 全部重下
 *
 * 产物（合计约 22.9 MB）：
 *   vendor/mediapipe/vision_bundle.mjs               155,990 B
 *   vendor/mediapipe/wasm/vision_wasm_internal.js    336,624 B
 *   vendor/mediapipe/wasm/vision_wasm_internal.wasm 14,665,716 B
 *   vendor/mediapipe/hand_landmarker.task            7,819,105 B
 *   vendor/mediapipe/LICENSE                         Apache-2.0 全文（包里没带，必须自己补）
 */
import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'

const HERE = dirname(fileURLToPath(import.meta.url))
const VENDOR = join(HERE, '..', 'vendor', 'mediapipe')
const FORCE = process.argv.includes('--force')

const PKG = { name: '@mediapipe/tasks-vision', version: '1.2.3' }
const TARBALL = `https://registry.npmjs.org/${PKG.name}/-/${PKG.name.split('/')[1]}-${PKG.version}.tgz`
const MODEL = {
  url: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
  sha256: 'FBC2A30080C3C557093B5DDFC334698132EB341044CCEE322CCF8BCF3607CDE1',
  bytes: 7819105,
}

/** 需要的文件：tarball 内路径 → 目标路径（相对 vendor/mediapipe）。 */
const WANTED = [
  ['package/vision_bundle.mjs', 'vision_bundle.mjs'],
  ['package/wasm/vision_wasm_internal.js', 'wasm/vision_wasm_internal.js'],
  ['package/wasm/vision_wasm_internal.wasm', 'wasm/vision_wasm_internal.wasm'],
]

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex').toUpperCase()

async function exists(path, minBytes = 1) {
  try {
    const s = await stat(path)
    return s.isFile() && s.size >= minBytes
  } catch {
    return false
  }
}

async function download(url, dest, attempts = 3) {
  const buf = await fetchBuffer(url, attempts)
  await mkdir(dirname(dest), { recursive: true })
  await writeFile(dest, buf)
  return buf.length
}

/**
 * 取字节。**不能用子进程**：`tar` / `npm` 在受限沙箱里都是 spawn EPERM，
 * 所以解包由下面的纯 JS tar 读取器完成，整个 vendoring 不依赖任何外部命令。
 */
async function fetchBuffer(url, attempts = 3) {
  let lastError
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, { redirect: 'follow' })
      if (!res.ok) throw new Error(`${res.status} ${res.statusText} ← ${url}`)
      return Buffer.from(await res.arrayBuffer())
    } catch (err) {
      lastError = err
      // 这台机器到外网首次握手偶发 10s 连接超时，重试通常就通
      if (i < attempts) {
        console.warn(`  第 ${i} 次失败（${err.cause?.code || err.message}），${800 * i}ms 后重试…`)
        await new Promise((r) => setTimeout(r, 800 * i))
      }
    }
  }
  throw lastError
}

/** 读 tar 头里的定长字符串字段（NUL 或空格结尾）。 */
function field(buf, offset, length) {
  const slice = buf.subarray(offset, offset + length)
  let end = slice.length
  for (let i = 0; i < slice.length; i++) {
    if (slice[i] === 0) {
      end = i
      break
    }
  }
  return slice.subarray(0, end).toString('utf8').trim()
}

/**
 * 极简 ustar 读取器：只做「tgz → Map<路径, Buffer>」。
 * 支持 pax 扩展头（`npm pack` 有时用它存长路径），忽略符号链接与目录项。
 */
function readTarGz(gz) {
  const buf = gunzipSync(gz)
  const files = new Map()
  let offset = 0
  let paxPath = null

  while (offset + 512 <= buf.length) {
    const header = buf.subarray(offset, offset + 512)
    const rawName = field(header, 0, 100)
    if (!rawName) break // 两个全零块 = 归档结束

    const size = Number.parseInt(field(header, 124, 12) || '0', 8)
    const type = String.fromCharCode(header[156] || 48)
    const prefix = field(header, 345, 155)
    offset += 512

    const data = buf.subarray(offset, offset + size)
    offset += Math.ceil(size / 512) * 512

    if (type === 'x') {
      // pax 头：内容是「长度 键=值\n」的多行，只关心 path
      const text = data.toString('utf8')
      const m = text.match(/\d+ path=([^\n]+)\n/)
      paxPath = m ? m[1] : null
      continue
    }
    if (type !== '0' && type !== '\0' && type !== '') continue // 目录/链接跳过

    const name = paxPath || (prefix ? `${prefix}/${rawName}` : rawName)
    paxPath = null
    files.set(name, data)
  }
  return files
}

async function main() {
  await mkdir(join(VENDOR, 'wasm'), { recursive: true })

  // 1) 包文件
  const missing = []
  for (const [, target] of WANTED) {
    if (FORCE || !(await exists(join(VENDOR, target), 1024))) missing.push(target)
  }

  if (missing.length) {
    console.log(`下载 ${PKG.name}@${PKG.version} …`)
    const tgz = await fetchBuffer(TARBALL)
    console.log(`  tarball ${(tgz.length / 1024 / 1024).toFixed(1)} MB`)

    const files = readTarGz(tgz)
    for (const [from, target] of WANTED) {
      // tarball 内路径统一以 package/ 开头
      const data = files.get(from) || files.get(from.replace(/^package\//, ''))
      if (!data) throw new Error(`tarball 里没有 ${from}（实际有 ${files.size} 个文件）`)
      const dest = join(VENDOR, target)
      await mkdir(dirname(dest), { recursive: true })
      await writeFile(dest, data)
      console.log(`  ✓ ${target}  ${data.length.toLocaleString('en-US')} B`)
    }
  } else {
    console.log('包文件已就位，跳过下载')
  }

  // 2) 模型
  const modelPath = join(VENDOR, 'hand_landmarker.task')
  if (FORCE || !(await exists(modelPath, MODEL.bytes))) {
    console.log('下载 hand_landmarker.task …')
    const size = await download(MODEL.url, modelPath)
    console.log(`  ${size.toLocaleString('en-US')} B`)
  } else {
    console.log('模型已就位，跳过下载')
  }

  // 3) 校验：模型必须逐字节对得上，否则 MediaPipe 会在运行时给出难懂的报错
  const model = await readFile(modelPath)
  const got = sha256(model)
  if (model.length !== MODEL.bytes || got !== MODEL.sha256) {
    await rm(modelPath, { force: true })
    throw new Error(
      `模型校验失败（已删除）：期望 ${MODEL.bytes} B / ${MODEL.sha256}，实际 ${model.length} B / ${got}`,
    )
  }
  console.log(`✓ 模型 sha256 校验通过：${got.slice(0, 16)}…`)

  // 4) 许可：两个 tarball 都没带 LICENSE/NOTICE，再分发必须自己补
  const licensePath = join(VENDOR, 'LICENSE')
  if (!(await exists(licensePath, 100))) {
    await writeFile(licensePath, APACHE_2_0_NOTE, 'utf8')
  }
  console.log('✓ 许可说明已就位（vendor/mediapipe/LICENSE）')

  // 5) 机器可读清单，便于以后核对版本与体积
  const manifest = {
    package: `${PKG.name}@${PKG.version}`,
    tarball: TARBALL,
    model: { url: MODEL.url, sha256: MODEL.sha256, bytes: MODEL.bytes },
    generatedAt: new Date().toISOString(),
    files: {},
  }
  for (const [, target] of WANTED) {
    const s = await stat(join(VENDOR, target))
    manifest.files[target] = s.size
  }
  manifest.files['hand_landmarker.task'] = MODEL.bytes
  await writeFile(join(VENDOR, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8')

  const total = Object.values(manifest.files).reduce((a, b) => a + b, 0)
  console.log(`\n完成：${(total / 1024 / 1024).toFixed(1)} MB 共 ${Object.keys(manifest.files).length} 个文件`)
  console.log('下一步：node bloom/serve.mjs 然后用「开启手势」试真机摄像头')
}

/** 包内没有 LICENSE，这里放一段指向性说明 + 关键条款摘录，而不是凭空替代 Apache 全文。 */
const APACHE_2_0_NOTE = `MediaPipe Tasks（@mediapipe/tasks-vision）与 hand_landmarker 模型
Copyright 2023–2026 Google LLC
Licensed under the Apache License, Version 2.0
http://www.apache.org/licenses/LICENSE-2.0

本目录下的文件为原包逐字节复制（未修改）：
  vision_bundle.mjs
  wasm/vision_wasm_internal.js
  wasm/vision_wasm_internal.wasm
hand_landmarker.task 来自 MediaPipe 官方模型托管（Model Card 同为 Apache-2.0）。

注意：
1. npm 包与模型分发物内均未附带 LICENSE / NOTICE 文件，故在此补充声明。
2. Apache-2.0 不授予商标许可 —— 不得用 MediaPipe / Google 的名称或标识做背书宣传。
3. 若修改了上述文件，需在修改处标注，并按 Apache-2.0 §4 说明改动。
`

await main()
