// 上线守候：DNS 生效 + 安全组 443 放行后，自动跑 enable-https.sh 收尾。
//
// 为什么需要它：DNS 生效要 1–10 分钟（等递归缓存），安全组改完也要等一会儿生效，
// 这段时间人盯着的收益很低。守候进程按固定间隔探测两个前置条件，
// 全部满足就执行服务器上的一键脚本并跑验收。
//
// 只做两件事：探测 + 在满足条件时调用既有脚本。不改任何前置条件本身。
//
// 用法：
//   node scripts/watch-online-ready.mjs              # 守候（最长 60 分钟）
//   node scripts/watch-online-ready.mjs --timeout 30  # 守候 30 分钟
//   node scripts/watch-online-ready.mjs --once        # 只探测一次就退出

import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const dns = require('node:dns')
dns.setServers(['223.5.5.5', '119.29.29.29'])

const args = process.argv.slice(2)
const argOf = (name, dflt) => {
  const i = args.indexOf(name)
  return i !== -1 && args[i + 1] ? args[i + 1] : dflt
}

const DOMAIN = 'wpersist.top'
const ALT_DOMAIN = 'www.wpersist.top'
const SSH_HOST = 'persist-server'
const TIMEOUT_MIN = Number(argOf('--timeout', '60'))
const ONCE = args.includes('--once')
const INTERVAL_SEC = Number(argOf('--interval', '20'))

const DEADLINE = Date.now() + TIMEOUT_MIN * 60_000

const log = (msg) => console.log(`[${new Date().toLocaleTimeString('zh-CN')}] ${msg}`)

async function resolveA(host) {
  try {
    return { addresses: await dns.promises.resolve4(host) }
  } catch (err) {
    return { error: err.code || err.message }
  }
}

function tcpProbe(host, port, timeoutMs = 5000) {
  const net = require('node:net')
  return new Promise((resolve) => {
    const socket = new net.Socket()
    let settled = false
    const finish = (r) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(r)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish({ open: true }))
    socket.once('timeout', () => finish({ open: false, reason: 'timeout' }))
    socket.once('error', (e) => finish({ open: false, reason: e.code || e.message }))
    socket.connect(port, host)
  })
}

function serverIp() {
  try {
    return execFileSync(
      'ssh',
      ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', SSH_HOST, 'curl -s -m 8 ifconfig.me'],
      { encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim()
  } catch {
    return null
  }
}

/** 探测一次，返回 { ready, apex, alt, p443, ip } */
async function probe() {
  const apex = await resolveA(DOMAIN)
  const alt = await resolveA(ALT_DOMAIN)
  const ip = serverIp()
  const p443 = ip ? await tcpProbe(ip, 443) : { open: false, reason: 'no-ip' }
  return {
    apex: apex.addresses ?? [],
    alt: alt.addresses ?? [],
    apexErr: apex.error ?? null,
    altErr: alt.error ?? null,
    p443,
    ip,
  }
}

function describe(s) {
  const a = s.apex.length ? s.apex.join(',') : `✗(${s.apexErr})`
  const w = s.alt.length ? s.alt.join(',') : `✗(${s.altErr})`
  const p = s.p443.open ? '✓开放' : `✗${s.p443.reason}`
  return `${DOMAIN}=${a}  ${ALT_DOMAIN}=${w}  443=${p}`
}

async function main() {
  log('上线守候启动 —— 等 DNS 生效 + 安全组 443 放行')
  log(`最长守候 ${TIMEOUT_MIN} 分钟，探测间隔 ${INTERVAL_SEC} 秒`)

  let s = await probe()
  log(`当前：${describe(s)}`)

  if (ONCE) {
    process.exit(s.apex.length && s.alt.length && s.p443.open ? 0 : 1)
  }

  let announced = false
  while (Date.now() < DEADLINE) {
    s = await probe()
    const ready = s.apex.length > 0 && s.alt.length > 0 && s.p443.open

    if (ready) {
      log('✓ 前置条件全部满足 —— 执行一键 HTTPS 启用脚本')
      try {
        const out = execFileSync(
          'ssh',
          [
            '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', SSH_HOST,
            'bash /opt/persist-next/deploy/enable-https.sh',
          ],
          { encoding: 'utf8', timeout: 300000 },
        )
        log('--- 脚本输出 ---')
        console.log(out)
        log('✓ 已完成，请回到对话查看验收结果')
      } catch (err) {
        log('✗ 脚本执行失败：')
        console.log(err.stdout ?? '')
        console.log(err.stderr ?? '')
      }
      process.exit(0)
    }

    if (!announced) {
      const missing = []
      if (!s.apex.length) missing.push(`${DOMAIN} 的 A 记录`)
      if (!s.alt.length) missing.push(`${ALT_DOMAIN} 的 A 记录`)
      if (!s.p443.open) missing.push('安全组 443 放行')
      log(`等待中，还差：${missing.join(' / ')}`)
      announced = true
    }

    await new Promise((r) => setTimeout(r, INTERVAL_SEC * 1000))
  }

  log(`守候超时（${TIMEOUT_MIN} 分钟）。当前状态：${describe(s)}`)
  log('未做任何改动 —— 手动重跑：node scripts/watch-online-ready.mjs')
  process.exit(1)
}

await main()
