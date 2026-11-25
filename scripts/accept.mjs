#!/usr/bin/env node
/**
 * 一条命令跑完全部验收（2026-11-24）。
 *
 * 为什么要有它：验收脚本原本散在四个地方（根 scripts/、deploy/scripts/、
 * gesture-particle-fusion-20261121/scripts/、bloom/scripts/、intro-stage/scripts/），
 * 每次改完都要记得「哪几个要起服务、哪几个要 file://、哪个要走 full-access」。
 * 这里把「组 → 步骤」固定下来，需要的本地服务自动起停，最后给一张汇总表并不为零退出。
 *
 * 用法：
 *   node scripts/accept.mjs                    # 默认组：static web intro fusion bloom intro-stage
 *   node scripts/accept.mjs --only static,web  # 只跑指定组
 *   node scripts/accept.mjs --all              # 全部（含 product / e2e，慢）
 *   node scripts/accept.mjs --list             # 列出组与步骤，不执行
 *   node scripts/accept.mjs --verbose          # 实时打印子进程输出
 *
 * 前置：
 *   · 浏览器相关的组依赖 `app/node_modules/playwright-core` + 已安装的 Chromium；
 *     在受沙箱限制的 shell 里会 `spawn EPERM`，需要一次性放宽权限。
 *   · `product` / `e2e` 依赖 `server/` `app/` 的 node_modules，且耗时数分钟。
 *
 * 注意：`web` / `intro` / `fusion` / `bloom` / `intro-stage` 组会重拍证据图
 * （`preview/*.png` 等，多数已入库），跑完工作区可能有改动，属预期。
 */
import { spawn } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const IS_WIN = process.platform === 'win32'

/* ---------------------------------------------------------------- 输出 */

const COLOR = process.stdout.isTTY && !process.env.NO_COLOR
const c = (code, s) => (COLOR ? `\x1b[${code}m${s}\x1b[0m` : s)
const green = (s) => c(32, s)
const red = (s) => c(31, s)
const yellow = (s) => c(33, s)
const dim = (s) => c(2, s)
const bold = (s) => c(1, s)

/* ---------------------------------------------------------------- 服务 */

/**
 * 需要本地 HTTP 服务的组。`ready` 用来判活：已经有人在这个端口上（比如你手开着
 * `serve-repo.mjs`）就直接复用，不重复启动、结束时也不去杀别人的进程。
 */
const SERVERS = {
  repo: {
    label: '仓库静态服务 :4173',
    cmd: ['node', 'scripts/serve-repo.mjs', '4173'],
    cwd: ROOT,
    ready: 'http://127.0.0.1:4173/landing/index.html',
  },
  introStage: {
    label: 'intro-stage 服务 :4201',
    cmd: ['node', 'serve.mjs', '4201'],
    cwd: join(ROOT, 'intro-stage'),
    ready: 'http://127.0.0.1:4201/',
  },
}

/* ---------------------------------------------------------------- 步骤 */

const node = (...args) => ['node', ...args]
/** Windows 上 `npm` 是 .cmd，直接 spawn 会 EINVAL，走 cmd.exe /c */
const npm = (args, cwd) => ({ cmd: IS_WIN ? ['cmd.exe', '/c', 'npm', ...args] : ['npm', ...args], cwd })

const GROUPS = {
  static: {
    label: '静态校验（无浏览器，秒级）',
    steps: [
      { name: 'OG 标签与卡面尺寸', cmd: node('scripts/check-og-meta.mjs') },
      { name: '备案占位一致性', cmd: node('deploy/scripts/render-site-info.mjs', '--check') },
      { name: '内联引擎一致性', cmd: node('scripts/inline-intro-engine.mjs', '--check') },
      { name: '明文密钥扫描', cmd: node('scripts/check-secrets.mjs') },
    ],
  },

  web: {
    label: '落地页 / 介绍首页 / OG 卡（file://）',
    steps: [
      { name: '落地页 check-landing', cmd: node('scripts/check-landing.mjs'), timeoutMs: 240_000 },
      { name: '介绍首页 check-home', cmd: node('scripts/check-home.mjs'), timeoutMs: 180_000 },
      { name: 'OG 卡版式 check-og-card', cmd: node('scripts/check-og-card.mjs'), timeoutMs: 120_000 },
    ],
  },

  intro: {
    label: '开场：界面壳 + 粒子（需要 :4173）',
    server: 'repo',
    steps: [
      { name: '界面壳 check-intro-shell', cmd: node('scripts/check-intro-shell.mjs'), timeoutMs: 240_000 },
      { name: '粒子淡入 check-intro-particle', cmd: node('scripts/check-intro-particle.mjs'), timeoutMs: 240_000 },
    ],
  },

  fusion: {
    label: '融合工程两场景（脚本自带服务）',
    steps: [
      {
        name: '两场景 + 手势 shoot',
        cmd: node('scripts/shoot.mjs'),
        cwd: join(ROOT, 'gesture-particle-fusion-20261121'),
        timeoutMs: 300_000,
      },
    ],
  },

  bloom: {
    label: 'bloom 画面（脚本自带服务）',
    steps: [
      { name: '画面 shoot', cmd: node('scripts/shoot.mjs'), cwd: join(ROOT, 'bloom'), timeoutMs: 300_000 },
    ],
  },

  'bloom-unit': {
    label: 'bloom 手势单测（纯 node，不需要浏览器/node_modules）',
    steps: [
      {
        name: '手势单测 tension.test',
        cmd: node('--test', 'tests/tension.test.mjs'),
        cwd: join(ROOT, 'bloom'),
        timeoutMs: 120_000,
      },
    ],
  },

  'intro-stage': {
    label: '独立仓库 intro-stage（需要 :4201）',
    server: 'introStage',
    steps: [
      {
        name: '独立仓库自检',
        cmd: node('scripts/check.mjs'),
        cwd: join(ROOT, 'intro-stage'),
        timeoutMs: 240_000,
      },
    ],
  },

  product: {
    label: '产品本体 typecheck / test / lint（慢，数分钟）',
    steps: [
      { name: 'server typecheck', ...npm(['run', 'typecheck'], join(ROOT, 'server')), timeoutMs: 300_000 },
      { name: 'server test', ...npm(['test'], join(ROOT, 'server')), timeoutMs: 600_000 },
      { name: 'app typecheck', ...npm(['run', 'typecheck'], join(ROOT, 'app')), timeoutMs: 300_000 },
      { name: 'app test', ...npm(['test'], join(ROOT, 'app')), timeoutMs: 600_000 },
      { name: 'app lint', ...npm(['run', 'lint'], join(ROOT, 'app')), timeoutMs: 180_000 },
    ],
  },

  e2e: {
    label: '产品 E2E（最慢）',
    steps: [{ name: 'app test:e2e', ...npm(['run', 'test:e2e'], join(ROOT, 'app')), timeoutMs: 900_000 }],
  },
}

const DEFAULT_GROUPS = ['static', 'web', 'intro', 'fusion', 'bloom-unit', 'bloom', 'intro-stage']

/* ---------------------------------------------------------------- 子进程 */

function run({ cmd, cwd = ROOT, timeoutMs = 180_000 }, { verbose = false } = {}) {
  return new Promise((resolveRun) => {
    const t0 = Date.now()
    let child
    try {
      child = spawn(cmd[0], cmd.slice(1), {
        cwd,
        stdio: verbose ? 'inherit' : 'pipe',
        windowsHide: true,
        env: { ...process.env, FORCE_COLOR: process.env.FORCE_COLOR ?? '0' },
      })
    } catch (err) {
      resolveRun({ ok: false, ms: 0, tail: `spawn 失败：${err.message}` })
      return
    }

    let buf = ''
    const keep = (chunk) => {
      buf += chunk.toString()
      if (buf.length > 8000) buf = buf.slice(-8000) // 只留尾部，失败时够定位
    }
    if (!verbose) {
      child.stdout?.on('data', keep)
      child.stderr?.on('data', keep)
    }

    let timer = null
    let timedOut = false
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true
        try { child.kill() } catch { /* ignore */ }
      }, timeoutMs)
    }

    const done = (code, signal, err) => {
      if (timer) clearTimeout(timer)
      const ms = Date.now() - t0
      const ok = !timedOut && !err && code === 0
      let tail = ''
      if (!ok) {
        const lines = buf.trim().split('\n')
        tail = (timedOut ? `超时（${Math.round(timeoutMs / 1000)}s）\n` : '') +
          (err ? `${err.message}\n` : '') +
          lines.slice(-14).join('\n')
      }
      resolveRun({ ok, ms, tail, signal })
    }

    child.on('error', (err) => done(null, null, err))
    child.on('close', (code, signal) => done(code, signal, null))
  })
}

async function isUp(url, timeoutMs = 1500) {
  try {
    const ctl = AbortSignal.timeout(timeoutMs)
    const res = await fetch(url, { signal: ctl })
    return res.ok || res.status < 500
  } catch {
    return false
  }
}

async function waitUp(url, timeoutMs = 20_000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    if (await isUp(url, 1200)) return true
    await new Promise((r) => setTimeout(r, 250))
  }
  return false
}

async function startServer(key) {
  const def = SERVERS[key]
  if (await isUp(def.ready)) return { key, reused: true, child: null, def }
  const child = spawn(def.cmd[0], def.cmd.slice(1), {
    cwd: def.cwd,
    stdio: 'ignore',
    windowsHide: true,
  })
  const ok = await waitUp(def.ready)
  if (!ok) {
    try { child.kill() } catch { /* ignore */ }
    return { key, reused: false, child: null, def, failed: true }
  }
  return { key, reused: false, child, def }
}

function stopServer(s) {
  if (!s || !s.child) return
  try { s.child.kill() } catch { /* ignore */ }
}

/* ---------------------------------------------------------------- CLI */

function parseArgs(argv) {
  const out = { only: null, all: false, list: false, verbose: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--all') out.all = true
    else if (a === '--list') out.list = true
    else if (a === '--verbose' || a === '-v') out.verbose = true
    else if (a === '--only') out.only = (argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean)
    else if (a === '--help' || a === '-h') out.help = true
    else {
      console.error(red(`未知参数：${a}`))
      out.bad = true
    }
  }
  return out
}

function usage() {
  console.log(`${bold('用法')}
  node scripts/accept.mjs                    # 默认组：${DEFAULT_GROUPS.join(' ')}
  node scripts/accept.mjs --only static,web  # 只跑指定组
  node scripts/accept.mjs --all              # 全部（含 product / e2e）
  node scripts/accept.mjs --list             # 列出组与步骤
  node scripts/accept.mjs --verbose          # 实时打印子进程输出

${bold('组')}
${Object.entries(GROUPS).map(([k, g]) => `  ${k.padEnd(13)} ${g.label}${g.server ? dim('  [需要本地服务]') : ''}`).join('\n')}`)
}

function list() {
  for (const [key, g] of Object.entries(GROUPS)) {
    const tag = DEFAULT_GROUPS.includes(key) ? green('● 默认') : dim('○ 可选')
    console.log(`\n${bold(key)}  ${g.label}  ${tag}`)
    for (const s of g.steps) {
      console.log(dim(`  · ${s.name}  →  ${s.cmd.join(' ')}${s.cwd ? `  (cwd: ${s.cwd.replace(ROOT + (IS_WIN ? '\\' : '/'), '')})` : ''}`))
    }
  }
  console.log('')
}

/* ---------------------------------------------------------------- 主流程 */

const argv = parseArgs(process.argv.slice(2))
if (argv.help) { usage(); process.exit(0) }
if (argv.bad) { usage(); process.exit(2) }
if (argv.list) { list(); process.exit(0) }

const chosen = argv.all ? Object.keys(GROUPS) : (argv.only ?? DEFAULT_GROUPS)
const unknown = chosen.filter((k) => !GROUPS[k])
if (unknown.length) {
  console.error(red(`未知组：${unknown.join(', ')}`))
  console.error(dim(`可选：${Object.keys(GROUPS).join(', ')}`))
  process.exit(2)
}

const t0 = Date.now()
const results = [] // { group, step, ok, ms, tail }

for (const key of chosen) {
  const g = GROUPS[key]
  console.log(`\n${bold('▸ ' + key)}  ${dim(g.label)}`)

  let server = null
  if (g.server) {
    server = await startServer(g.server)
    if (server.failed) {
      console.log(`  ${red('✗')} 本地服务起不来：${server.def.label}`)
      for (const s of g.steps) results.push({ group: key, step: s.name, ok: false, ms: 0, tail: '本地服务未就绪' })
      continue
    }
    console.log(dim(`  · 服务 ${server.def.label}${server.reused ? '（已有实例，复用）' : ' 已启动'}`))
  }

  try {
    for (const step of g.steps) {
      process.stdout.write(`  … ${step.name}`)
      const r = await run({ ...step, cwd: step.cwd ?? ROOT }, { verbose: argv.verbose })
      process.stdout.write('\r' + ' '.repeat(step.name.length + 6) + '\r')
      const ms = `${(r.ms / 1000).toFixed(1)}s`
      console.log(`  ${r.ok ? green('✓') : red('✗')} ${step.name.padEnd(30)} ${dim(ms)}`)
      results.push({ group: key, step: step.name, ok: r.ok, ms: r.ms, tail: r.tail })
    }
  } finally {
    stopServer(server)
  }
}

/* ---------------------------------------------------------------- 汇总 */

const failed = results.filter((r) => !r.ok)
const total = (Date.now() - t0) / 1000

console.log('\n' + '─'.repeat(64))
for (const r of results) {
  console.log(`${r.ok ? green('✓') : red('✗')} ${r.group.padEnd(13)} ${r.step}`)
}
if (failed.length) {
  console.log('\n' + red(bold('失败详情')))
  for (const f of failed) {
    console.log(`\n${red('✗')} ${bold(f.group + ' / ' + f.step)}`)
    if (f.tail) console.log(dim(f.tail))
  }
}
const skipped = chosen.length - new Set(results.map((r) => r.group)).size
console.log(
  `\n${failed.length ? red(bold('未通过')) : green(bold('通过'))}  ` +
  `${results.length - failed.length} 项通过 · ${failed.length} 项失败` +
  (skipped > 0 ? ` · ${skipped} 组未执行` : '') +
  ` · 用时 ${total < 60 ? total.toFixed(1) + 's' : Math.round(total / 60) + 'm' + Math.round(total % 60) + 's'}`,
)
process.exit(failed.length ? 1 : 0)
