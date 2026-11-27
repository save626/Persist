// 上线就绪自检：一条命令看清「还差什么才能开 HTTPS」。
//
// 为什么需要它：上线要跨两个世界 —— 阿里云控制台（DNS 解析、安全组 443）和
// 服务器（证书、Nginx 配置）。两边任何一环没到位，签发就会失败，
// 而失败原因在 certbot 输出里往往是一句含糊的「无法验证域名」。
// 这个脚本把前置条件逐条量化，让「还差什么」变成明确的清单。
//
// 用法：
//   node scripts/check-online-ready.mjs            # 全量检查
//   node scripts/check-online-ready.mjs --json     # 机器可读
//
// 只读：不写任何文件，不改任何线上内容，不申请证书。

import { createRequire } from 'node:module'
import https from 'node:https'

const require = createRequire(import.meta.url)
const dns = require('node:dns')
dns.setServers(['223.5.5.5', '119.29.29.29'])
const dnsPromises = dns.promises
const { execFileSync } = require('node:child_process')

const args = process.argv.slice(2)
const asJson = args.includes('--json')

const DOMAIN = 'wpersist.top'
const ALT_DOMAIN = 'www.wpersist.top'
const SSH_HOST = 'persist-server'

const checks = []
const add = (name, status, detail) => checks.push({ name, status, detail })
const ok = (name, detail) => add(name, 'ok', detail)
const warn = (name, detail) => add(name, 'warn', detail)
const fail = (name, detail) => add(name, 'fail', detail)

// ---------------------------------------------------------------- DNS

/**
 * 用 DoH（DNS-over-HTTPS）查 A 记录。
 *
 * 为什么必须走 DoH：递归解析器（223.5.5.5 等）在权威记录写入后仍可能返回
 * 负缓存结论（NOERROR 无 Answer / NXDOMAIN），会把「已生效」误报成「没加记录」。
 * 2026-11-27 实测：腾讯 DoH 已返回新记录，阿里递归仍报 ENODATA。
 */
function dohResolve(host, type = 'A') {
  return new Promise((resolve) => {
    const url = `https://doh.pub/dns-query?name=${encodeURIComponent(host)}&type=${type}`
    const req = https.get(url, { timeout: 8000 }, (r) => {
      let body = ''
      r.on('data', (c) => (body += c))
      r.on('end', () => {
        try {
          const data = JSON.parse(body)
          const addrs = (data.Answer || []).filter((a) => a.type === 1).map((a) => a.data)
          resolve(
            addrs.length
              ? { addresses: addrs }
              : { error: data.Status === 3 ? 'ENOTFOUND' : 'ENODATA' },
          )
        } catch {
          resolve({ error: 'BADJSON' })
        }
      })
    })
    req.on('error', (e) => resolve({ error: e.code || e.message }))
    req.on('timeout', () => {
      req.destroy()
      resolve({ error: 'TIMEOUT' })
    })
  })
}

async function resolveA(host) {
  // DoH 优先；DoH 不可用时退回递归解析器。
  const doh = await dohResolve(host)
  if (doh.addresses) return doh
  try {
    const res = await dnsPromises.resolve4(host)
    return { addresses: res }
  } catch (err) {
    // ENODATA / ENOTFOUND 都是「没有 A 记录」，但语义要分开：
    // ENODATA = 域名已存在（已备案、NS 已挂），只是没加解析记录；
    // ENOTFOUND = 域名本身查不到（NS 没挂或拼错了）。
    return { error: err.code || err.message }
  }
}

/** 服务器公网 IP：域名没解析时也能探测端口。
 *  优先 --ip，其次从服务器上问（权威来源，且本机 DNS 缓存不影响）。 */
function serverPublicIp() {
  const i = args.indexOf('--ip')
  if (i !== -1 && args[i + 1]) return args[i + 1]
  try {
    return execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', SSH_HOST, 'curl -s -m 8 ifconfig.me'], {
      encoding: 'utf8',
      timeout: 15000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return null
  }
}

// ---------------------------------------------------------------- 端口

async function tcpProbe(host, port, timeoutMs = 6000) {
  const net = require('node:net')
  return new Promise((resolve) => {
    const socket = new net.Socket()
    let settled = false
    const finish = (result) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(result)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish({ open: true }))
    socket.once('timeout', () => finish({ open: false, reason: 'timeout' }))
    socket.once('error', (err) => finish({ open: false, reason: err.code || err.message }))
    socket.connect(port, host)
  })
}

// ---------------------------------------------------------------- HTTP

async function httpProbe(url, method = 'GET') {
  const https = require('node:https')
  const http = require('node:http')
  const lib = url.startsWith('https:') ? https : http
  return new Promise((resolve) => {
    let body = ''
    let settled = false
    const finish = (r) => {
      if (settled) return
      settled = true
      resolve(r)
    }
    const req = lib.request(
      url,
      { method, timeout: 8000, rejectUnauthorized: false },
      (res) => {
        res.on('data', (c) => {
          body += c
          // 超长响应（落地页近 1 MB）提前收尾。
          // 注意：req.destroy() 不带 error 时不会触发 'end' 也不触发 'error'，
          // 只靠 'close' 收口，否则 Promise 永远不 resolve（2026-11-27 实测卡死）。
          if (body.length > 200000) {
            finish({ status: res.statusCode, headers: res.headers, body })
            req.destroy()
          }
        })
        res.on('end', () => finish({ status: res.statusCode, headers: res.headers, body }))
        res.on('close', () => finish({ status: res.statusCode, headers: res.headers, body }))
      },
    )
    req.on('timeout', () => {
      req.destroy()
      finish({ status: 0, error: 'timeout' })
    })
    req.on('error', (err) => finish({ status: 0, error: err.code || err.message }))
    req.on('close', () => finish({ status: 0, error: 'closed' }))
    req.end()
  })
}

// ---------------------------------------------------------------- 主流程

async function main() {
  // 1) DNS
  const apex = await resolveA(DOMAIN)
  if (apex.addresses) {
    ok('DNS · wpersist.top', apex.addresses.join(', '))
  } else {
    const hint =
      apex.error === 'ENODATA'
        ? '域名已存在但没有 A 记录 —— 阿里云云解析加一条 A 记录，值填服务器公网 IP'
        : '查不到该域名 —— 确认域名拼写与云解析 NS 是否生效'
    fail('DNS · wpersist.top', `无 A 记录（${apex.error}）—— ${hint}`)
  }

  const alt = await resolveA(ALT_DOMAIN)
  if (alt.addresses) {
    ok('DNS · www.wpersist.top', alt.addresses.join(', '))
  } else {
    fail(
      'DNS · www.wpersist.top',
      `无 A 记录（${alt.error}）—— 证书要双 SAN，www 也得有一条 A 记录指向同一 IP`,
    )
  }

  // 2) 端口：优先探解析出来的地址；域名还没解析时探服务器公网 IP，
  //    这样「安全组 443 放行了没」现在就能查，不必等 DNS。
  const serverIp = serverPublicIp()
  const probeHost = apex.addresses ? apex.addresses[0] : serverIp
  const probeLabel = apex.addresses ? '（走域名解析）' : serverIp ? '（走服务器公网 IP）' : '（未知地址）'

  if (!probeHost) {
    warn('端口 · 80', '跳过 —— 拿不到服务器地址')
    warn('端口 · 443', '跳过 —— 拿不到服务器地址')
  } else {
    const p80 = await tcpProbe(probeHost, 80)
    if (p80.open) ok('端口 · 80', `开放 ${probeLabel}（ACME HTTP-01 验证走它）`)
    else fail('端口 · 80', `不可连（${p80.reason}）${probeLabel} —— 安全组入方向需要 TCP 80`)

    const p443 = await tcpProbe(probeHost, 443)
    if (p443.open) ok('端口 · 443', `开放 ${probeLabel}（TLS 已在监听）`)
    else fail('端口 · 443', `不可连（${p443.reason}）${probeLabel} —— 安全组入方向需要放行 TCP 443`)
  }

  // 3) HTTPS 现状
  if (!apex.addresses) {
    warn('HTTPS · 首页', '跳过 —— 域名还没解析，无法访问')
    warn('HTTP · 首页', '跳过 —— 域名还没解析，无法访问')
  } else {
    const httpsRes = await httpProbe(`https://${DOMAIN}/`)
    if (httpsRes.status === 200) {
      ok('HTTPS · 首页', '200')
      const icp = httpsRes.body.match(/豫ICP备[0-9]+号/)?.[0]
      if (icp) ok('页脚 · ICP 备案号', icp)
      else fail('页脚 · ICP 备案号', '首页里没找到备案号')
    } else if (httpsRes.status === 0) {
      warn('HTTPS · 首页', `未通（${httpsRes.error}）—— 属正常：443 未开放或证书还没签`)
    } else {
      fail('HTTPS · 首页', `返回 ${httpsRes.status}`)
    }

    const httpRes = await httpProbe(`http://${DOMAIN}/`)
    if (httpRes.status === 0) {
      warn('HTTP · 首页', `未通（${httpRes.error}）`)
    } else if (httpRes.headers?.location?.startsWith('https://')) {
      ok('HTTP → HTTPS', `跳转 ${httpRes.headers.location}`)
    } else {
      warn('HTTP · 首页', `返回 ${httpRes.status}，未跳 HTTPS（跳转配置还没装，属正常）`)
    }
  }

  // 4) 本地事实源：备案号是否已填
  try {
    const { readFileSync } = require('node:fs')
    const { fileURLToPath } = require('node:url')
    const { dirname, resolve: r } = require('node:path')
    const ROOT = r(dirname(fileURLToPath(import.meta.url)), '..')
    const info = JSON.parse(readFileSync(r(ROOT, 'deploy', 'site-info.json'), 'utf8'))
    if (info.icpNumber) ok('site-info.json · icpNumber', info.icpNumber)
    else fail('site-info.json · icpNumber', '为空 —— 页脚不会显示任何编号')
    if (info.policeNumber) ok('site-info.json · policeNumber', info.policeNumber)
    else warn('site-info.json · policeNumber', '为空 —— 公安备案通过后需补，页脚才会显示公网安备号')
  } catch (err) {
    warn('site-info.json', `读取失败：${err.message}`)
  }

  // ---------------------------------------------------------------- 输出

  const failed = checks.filter((c) => c.status === 'fail')
  const warned = checks.filter((c) => c.status === 'warn')

  if (asJson) {
    console.log(JSON.stringify({ domain: DOMAIN, checks, failed: failed.length }, null, 2))
    process.exit(failed.length ? 1 : 0)
  }

  const mark = { ok: '✓', warn: '!', fail: '✗' }
  const color = { ok: '\x1b[32m', warn: '\x1b[33m', fail: '\x1b[31m' }
  console.log('\n上线就绪自检')
  console.log('='.repeat(60))
  for (const c of checks) {
    console.log(`${color[c.status]}${mark[c.status]}\x1b[0m ${c.name.padEnd(30)} ${c.detail}`)
  }
  console.log('='.repeat(60))

  if (failed.length) {
    console.log(`\n\x1b[31m未就绪：${failed.length} 项待处理\x1b[0m`)
    console.log('用户侧（阿里云控制台）：')
    if (checks.some((c) => c.name.startsWith('DNS'))) {
      console.log('  · 云解析 DNS → 公网权威解析 → 域名 wpersist.top → 解析设置 → 添加记录')
      console.log('    记录类型 A / 主机记录 @ / 记录值 = 服务器公网 IP / TTL 10 分钟')
      console.log('    再加一条 主机记录 www，指向同一 IP')
    }
    if (checks.some((c) => c.name.includes('443'))) {
      console.log('  · ECS 安全组 → 入方向 → 手动添加：TCP / 443 / 0.0.0.0/0')
      console.log('    ⚠ 别点「一键放行 Web 常见端口」——会把 SSH 22 和宝塔 8888 对公网全开')
    }
    console.log('服务器侧（我来做）：DNS + 443 都到位后，一条命令收尾 ——')
    console.log('  bash deploy/scripts/enable-https.sh')
    process.exit(1)
  }

  console.log(`\n\x1b[32m全部就绪\x1b[0m（${warned.length} 项提醒）`)
  process.exit(0)
}

await main()
