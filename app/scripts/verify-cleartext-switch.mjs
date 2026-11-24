/**
 * 明文流量开关推导的验证脚本。
 *
 * 覆盖三处必须保持一致的推导：
 *   1. app/capacitor.config.ts（server.cleartext / android.allowMixedContent）
 *   2. app/android/app/build.gradle（manifestPlaceholders.allowCleartext）
 *   3. app/android/app/src/main/AndroidManifest.xml（android:usesCleartextTraffic）
 *
 * 三者都读 app/.env.mobile.local 的 VITE_PERSIST_API_BASE_URL，规则相同：
 * 基址是 https:// → 不允许明文；否则允许。
 *
 * 用法：node scripts/verify-cleartext-switch.mjs
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const appRoot = resolve(import.meta.dirname, '..')

/** 复刻 capacitor.config.ts 的读取与推导。 */
function deriveFromEnv(content) {
  const matched = /^\s*VITE_PERSIST_API_BASE_URL\s*=\s*(.+?)\s*$/m.exec(content)
  const apiBaseUrl = matched?.[1]?.trim() ?? ''
  return { apiBaseUrl, allowCleartext: !/^https:\/\//i.test(apiBaseUrl) }
}

/** 复刻 build.gradle 的推导（Groovy 侧用 replaceFirst 去注释后 trim）。 */
function deriveLikeGradle(content) {
  const line = content
    .split('\n')
    .map((l) => l.replace(/#.*$/, '').trim())
    .find((l) => l.startsWith('VITE_PERSIST_API_BASE_URL='))
  const apiBaseUrl = line ? line.split('=').slice(1).join('=').trim() : ''
  return { apiBaseUrl, allowCleartext: !/^https:\/\//i.test(apiBaseUrl) }
}

const failures = []

function check(label, actual, expected) {
  const ok = actual === expected
  if (!ok) failures.push(`${label}: 期望 ${expected}，实际 ${actual}`)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label} = ${actual}`)
}

// --- 1. 当前 .env.mobile.local 的真实取值 ---
const envPath = resolve(appRoot, '.env.mobile.local')
let envContent = ''
try {
  envContent = readFileSync(envPath, 'utf8')
} catch {
  failures.push(`读不到 ${envPath}`)
}

const fromEnv = deriveFromEnv(envContent)
const fromGradle = deriveLikeGradle(envContent)

console.log(`--- 实际 .env.mobile.local ---`)
console.log(`baseUrl        = ${JSON.stringify(fromEnv.apiBaseUrl)}`)
console.log(`allowCleartext = ${fromEnv.allowCleartext}`)
console.log('')

check('capacitor.config.ts 推导与 gradle 一致', fromEnv.allowCleartext, fromGradle.allowCleartext)
check(
  '当前 http 基址 → 允许明文（保持现状）',
  fromEnv.allowCleartext,
  /^http:\/\//i.test(fromEnv.apiBaseUrl),
)

// --- 2. 合成用例：https 基址必须关掉明文 ---
const httpsCase = deriveFromEnv('VITE_PERSIST_API_BASE_URL=https://wpersist.top\n')
check('https 基址 → 禁止明文', httpsCase.allowCleartext, false)

const httpCase = deriveFromEnv('VITE_PERSIST_API_BASE_URL=http://127.0.0.1:3000\n')
check('http 基址 → 允许明文', httpCase.allowCleartext, true)

const emptyCase = deriveFromEnv('# 只有注释\n')
check('缺配置 → 允许明文（保守：宁可多放行也不静默断链）', emptyCase.allowCleartext, true)

const commentedCase = deriveFromEnv(
  '# VITE_PERSIST_API_BASE_URL=https://wpersist.top\nVITE_PERSIST_API_BASE_URL=http://127.0.0.1:3000\n',
)
check('注释行不干扰取值', commentedCase.apiBaseUrl, 'http://127.0.0.1:3000')

// --- 3. 三处配置必须都读同一个来源 ---
console.log('')
console.log('--- 三处一致性 ---')
const capacitorConfig = readFileSync(resolve(appRoot, 'capacitor.config.ts'), 'utf8')
const buildGradle = readFileSync(resolve(appRoot, 'android/app/build.gradle'), 'utf8')
const manifest = readFileSync(resolve(appRoot, 'android/app/src/main/AndroidManifest.xml'), 'utf8')

check(
  'capacitor.config.ts 读 .env.mobile.local',
  capacitorConfig.includes('.env.mobile.local'),
  true,
)
check('build.gradle 读 .env.mobile.local', buildGradle.includes('.env.mobile.local'), true)
check(
  'manifest 使用占位符而非硬编码 true',
  manifest.includes('android:usesCleartextTraffic="${allowCleartext}"'),
  true,
)
check(
  'manifest 未残留硬编码 usesCleartextTraffic="true"',
  /android:usesCleartextTraffic="true"/.test(manifest),
  false,
)
check(
  'manifest 声明 tools:replace（避免库 manifest 冲突导致构建失败）',
  manifest.includes('tools:replace="android:usesCleartextTraffic"'),
  true,
)
check(
  'build.gradle 提供 allowCleartext 占位符',
  buildGradle.includes('manifestPlaceholders = [allowCleartext: allowCleartext.toString()]'),
  true,
)

console.log('')
if (failures.length > 0) {
  console.error(`失败 ${failures.length} 项：`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log('全部通过。')
