#!/usr/bin/env node
/**
 * 明文密钥扫描（安全门禁，CI static 组必跑）。
 *
 * 背景：2026-11-25 安全审查发现 server/.env 与 app/.env.mobile.local 残留有效的
 * DeepSeek key（sk-）与 AI 回滚凭据（psa_）。这类文件被 .gitignore 排除、不进历史，
 * 但明文躺在工作区仍构成泄露面（备份 / 同步盘 / 他人使用本机）。
 *
 * 策略：扫描「仓库内可能保存凭据的文件」中的高置信度明文模式。
 * - 只认带固定前缀且长度足够的串，避免误伤普通文本与测试用例里的占位符（sk-test 等）。
 * - 白名单：*.example、node_modules、dist、构建产物、本脚本自身、git 元数据。
 * - 命中即以非零码退出并打印「文件:行号 + 前缀 + 长度」，不回显完整值。
 *
 * 用法：node scripts/check-secrets.mjs
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const SELF = resolve(fileURLToPath(import.meta.url))

/** 高置信度模式：前缀 + 足够长度。占位符（sk-test / psa_example）不会命中。 */
const PATTERNS = [
  { name: 'deepseek/sk key', re: /\bsk-[A-Za-z0-9]{20,}/g },
  { name: 'persist AI key', re: /\bpsa_[A-Za-z0-9_-]{20,}/g },
  { name: 'persist device token', re: /\bpst_[A-Za-z0-9_-]{20,}/g },
  { name: 'generic private key', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g },
]

/** 目录剪枝：这些目录不可能有我们关心的「工作区明文凭据」。 */
const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'dist-mobile', '.git', '.github',
  'build', 'coverage', 'test-results', 'preview',
  '.chrome-headless-desktop', '.chrome-headless-mobile',
  '.chrome-headless-mobile-v2', '.chrome-headless-mobile-v3',
  '.step13-review', '.idea',
])

/** 文件名白名单：示例模板不视为泄露。 */
const SKIP_FILES = new Set([
  'check-secrets.mjs', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock',
  'visual-check.mjs', // app/scripts 下的视觉检查 fixture，token 为固定合成值
])

const isExample = (name) => name === '.env.example' || name.endsWith('.example')

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (full === SELF) continue
    let stat
    try {
      stat = statSync(full)
    } catch {
      continue
    }
    if (stat.isDirectory()) {
      if (!SKIP_DIRS.has(entry)) yield* walk(full)
      continue
    }
    if (!stat.isFile()) continue
    if (SKIP_FILES.has(entry) || isExample(entry)) continue
    // 测试文件里的 psa_/pst_ 都是合成夹具（aaaa…/test/route-test），不是泄露。
    if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(entry)) continue
    // 只扫文本类文件：env / 配置 / 源码 / 脚本 / 文档 / SQL
    if (!/\.(env|env\.\w+|ts|tsx|js|mjs|cjs|json|md|sql|yml|yaml|conf|txt|sh|gradle|xml|html|css)$/i.test(entry)
      && !entry.startsWith('.env')) continue
    yield full
  }
}

const findings = []
for (const file of walk(ROOT)) {
  let content
  try {
    content = readFileSync(file, 'utf8')
  } catch {
    continue
  }
  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    for (const { name, re } of PATTERNS) {
      re.lastIndex = 0
      const hit = re.exec(lines[i])
      if (!hit) continue
      const value = hit[0]
      // 二次确认长度（模式已保证），仅展示前缀，不回显全文。
      findings.push({
        file: relative(ROOT, file).split(sep).join('/'),
        line: i + 1,
        kind: name,
        hint: `${value.slice(0, 6)}…(len=${value.length})`,
      })
    }
  }
}

if (findings.length > 0) {
  console.error('✗ 检测到疑似明文密钥，请立即移除并轮换：')
  for (const f of findings) console.error(`  ${f.file}:${f.line}  ${f.kind}  ${f.hint}`)
  console.error('\n提示：真实凭据只应放在服务器 600 权限的 env 文件中，且必须轮换已泄露的值。')
  process.exit(1)
}

console.log('✓ 明文密钥扫描通过：工作区未发现高置信度凭据。')
