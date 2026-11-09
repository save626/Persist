import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { openDatabase } from './driver.js'

/**
 * 步骤 14 的「备份」子集（先做，不等报告导出/恢复/删除）。
 *
 * 为什么现在就要：生产库已经不是空库了（有冒烟数据 + 一份真实 AI 报告），
 * 而删除/恢复接口要到步骤 14 才做，所以先把「能自动留底」这条腿落地，
 * 出问题时至少有一致副本可回到。
 *
 * 设计约束（P4 §11.3）：
 * - 每日 03:00 用 `VACUUM INTO` 生成一致快照（不是 cp：WAL 模式下直接拷文件会漏掉未 checkpoint 的内容）；
 * - 快照后做 `PRAGMA integrity_check` + sha256 旁车文件（sha256sum -c 可直接校验）；
 * - 保留 7 日 + 4 周（每周最新一份）+ 3 月（每月最新一份）；
 * - 删除前校验 sha256，校验不过就保留并告警，绝不为了腾地方删掉唯一可用的副本。
 *
 * 为什么不用 `sqlite3` 命令行：服务器上没装 sqlite3（也不能为这个装包），
 * 而 Node 22 的 `node:sqlite` 已经在跑生产库，`VACUUM INTO` 走同一条驱动即可。
 */

export type BackupReason = 'scheduled' | 'manual' | 'pre-restore'

export interface BackupPolicy {
  keepDays: number
  keepWeeks: number
  keepMonths: number
}

export const DEFAULT_BACKUP_POLICY: BackupPolicy = {
  keepDays: 7,
  keepWeeks: 4,
  keepMonths: 3,
}

const DAY_MS = 86_400_000
const BACKUP_NAME =
  /^persist-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-([a-z][a-z-]{2,19})\.sqlite$/

export interface BackupEntry {
  name: string
  path: string
  bytes: number
  /** 文件名里编码的创建时间（按 UTC 解释，只用于排序与年龄计算）。 */
  createdAt: number
  /** 周桶：该周周一的日期（YYYY-MM-DD）。 */
  weekKey: string
  /** 月桶：YYYY-MM。 */
  monthKey: string
}

/**
 * 从文件名解析出时间桶。文件名由 backupStamp 按服务器本地时区生成，
 * 这里也按本地时区反解，保证 createdAt 与运行环境时区一致。
 */
export function parseBackupName(name: string): BackupEntry | null {
  const match = BACKUP_NAME.exec(name)
  if (!match) return null
  const [, year, month, day, hour, minute, second] = match
  if (!year || !month || !day || !hour || !minute || !second) return null
  const numbers = [year, month, day, hour, minute, second].map((part) => Number(part))
  const [y, mo, d, h, mi, s] = numbers
  if (
    y === undefined ||
    mo === undefined ||
    d === undefined ||
    h === undefined ||
    mi === undefined ||
    s === undefined
  ) {
    return null
  }
  const createdAt = new Date(y, mo - 1, d, h, mi, s).getTime()
  const local = new Date(createdAt)
  if (
    Number.isNaN(createdAt) ||
    local.getFullYear() !== y ||
    local.getMonth() !== mo - 1 ||
    local.getDate() !== d ||
    local.getHours() !== h ||
    local.getMinutes() !== mi ||
    local.getSeconds() !== s
  ) {
    return null
  }
  const weekday = local.getDay()
  const mondayOffset = (weekday + 6) % 7
  const weekStart = new Date(y, mo - 1, d - mondayOffset)
  const weekKey = `${weekStart.getFullYear()}-${pad(weekStart.getMonth() + 1)}-${pad(weekStart.getDate())}`
  return {
    name,
    path: name,
    bytes: 0,
    createdAt,
    weekKey,
    monthKey: `${year}-${month}`,
  }
}

/** 列出备份目录里能认出名字的快照，按时间从新到旧。 */
export function listBackups(backupDir: string): BackupEntry[] {
  let names: string[]
  try {
    names = readdirSync(backupDir)
  } catch {
    return []
  }
  const entries: BackupEntry[] = []
  for (const name of names) {
    if (!name.endsWith('.sqlite')) continue
    const parsed = parseBackupName(name)
    if (!parsed) continue
    const path = join(backupDir, name)
    try {
      entries.push({ ...parsed, path, bytes: statSync(path).size })
    } catch {
      // 列目录与 stat 之间被删掉：忽略，不参与保留计算。
    }
  }
  entries.sort((a, b) => b.createdAt - a.createdAt || b.name.localeCompare(a.name))
  return entries
}

export interface RetentionPlan {
  keep: BackupEntry[]
  drop: BackupEntry[]
  /** 每份保留文件的理由：daily / weekly / monthly / newest，便于台账解释。 */
  reasons: Record<string, string>
}

function startOfLocalDay(ms: number): number {
  const date = new Date(ms)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/**
 * 纯函数：给定快照清单与「现在」，算出保留谁、删谁。
 * 规则与 P4 §11.3 一一对应，且「最新一份永远保留」优先于所有删除规则
 * ——宁可多留一份，也不能出现零备份。
 */
export function planRetention(
  entries: BackupEntry[],
  nowMs: number,
  policy: BackupPolicy = DEFAULT_BACKUP_POLICY,
): RetentionPlan {
  const sorted = [...entries].sort((a, b) => b.createdAt - a.createdAt)
  const keep: BackupEntry[] = []
  const drop: BackupEntry[] = []
  const reasons: Record<string, string> = {}
  const today = startOfLocalDay(nowMs)
  const keptWeeks = new Set<string>()
  const weeklyCandidates = new Set<string>()
  const keptMonths = new Set<string>()
  const monthlyCandidates = new Set<string>()

  // 第一轮：近 N 天全留（daily）。
  const rest: BackupEntry[] = []
  for (const entry of sorted) {
    const ageDays = Math.round((today - startOfLocalDay(entry.createdAt)) / DAY_MS)
    if (ageDays < policy.keepDays) {
      keep.push(entry)
      reasons[entry.name] = 'daily'
    } else {
      rest.push(entry)
    }
  }

  // 第二轮：每周最新的那一份（weekly），边界按「周一起算」。
  const weekly: BackupEntry[] = []
  for (const entry of rest) {
    const ageDays = Math.round((today - startOfLocalDay(entry.createdAt)) / DAY_MS)
    if (!weeklyCandidates.has(entry.weekKey) && ageDays < policy.keepWeeks * 7) {
      weeklyCandidates.add(entry.weekKey)
      keep.push(entry)
      reasons[entry.name] = 'weekly'
      keptWeeks.add(entry.weekKey)
    } else {
      weekly.push(entry)
    }
  }

  // 第三轮：每月最新的那一份（monthly），按 31 天/月的上限保守估算年龄。
  const monthly: BackupEntry[] = []
  for (const entry of weekly) {
    const ageDays = Math.round((today - startOfLocalDay(entry.createdAt)) / DAY_MS)
    if (!monthlyCandidates.has(entry.monthKey) && ageDays < policy.keepMonths * 31) {
      monthlyCandidates.add(entry.monthKey)
      keep.push(entry)
      reasons[entry.name] = 'monthly'
      keptMonths.add(entry.monthKey)
    } else {
      monthly.push(entry)
    }
  }

  drop.push(...monthly)

  // 兜底：最新一份无论如何保留，避免策略配成 0/0/0 时把全部备份删掉。
  const newest = sorted[0]
  if (newest) {
    const droppedIndex = drop.findIndex((entry) => entry.name === newest.name)
    if (droppedIndex >= 0) {
      drop.splice(droppedIndex, 1)
      keep.push(newest)
      reasons[newest.name] = 'newest'
    }
  }

  keep.sort((a, b) => b.createdAt - a.createdAt)
  drop.sort((a, b) => b.createdAt - a.createdAt)
  return { keep, drop, reasons }
}

export function sha256File(path: string): string {
  // 快照目前是几百 KB 量级；整读比流式读写都好懂，真到 GB 再换流式。
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/** 旁车文件用 sha256sum 的格式，运维可以直接 `sha256sum -c`。 */
export function checksumPath(path: string): string {
  return `${path}.sha256`
}

export function writeChecksumSidecar(path: string, name: string, sha256: string): void {
  // 用 writeFileSync 而不是 shell 重定向：不经过 shell，路径里有空格也不会被拆开。
  writeFileSync(checksumPath(path), `${sha256}  ${name}\n`, { encoding: 'utf8', mode: 0o640 })
}

/** 校验旁车文件；返回 null 表示缺少或对不上（调用方据此拒绝删除）。 */
export function readChecksumSidecar(path: string, name: string): string | null {
  const sidecar = checksumPath(path)
  if (!existsSync(sidecar)) return null
  const [hash, listed] = readFileSync(sidecar, 'utf8').trim().split(/\s+/)
  if (!hash || !/^[0-9a-f]{64}$/.test(hash)) return null
  // 旁车里记录的文件名必须对得上，防止人工拷错旁车把别的快照校验过去。
  if (listed !== undefined && listed !== name) return null
  try {
    return sha256File(path) === hash ? hash : null
  } catch {
    return null
  }
}

/** 打开快照库跑 `PRAGMA integrity_check`，返回 'ok' 或具体问题描述。 */
export function integrityCheck(path: string): string {
  // 只读打开：校验不得切换快照的 journal_mode，否则会改写文件并让旁车 sha256 失效。
  const db = openDatabase({ path, readOnly: true })
  try {
    const rows = db.prepare<{ integrity_check: string }>('PRAGMA integrity_check').all()
    const values = rows.map((row) => String(row.integrity_check))
    if (values.length === 1 && values[0] === 'ok') return 'ok'
    return values.join('; ') || 'empty'
  } finally {
    db.close()
  }
}

export interface RetentionSummary {
  kept: string[]
  dropped: string[]
  /** 校验不过/缺旁车而拒绝删除的旧快照。 */
  protected: string[]
  warnings: string[]
}

function summarize(inPlan: RetentionPlan): RetentionSummary {
  return {
    kept: inPlan.keep.map((entry) => entry.name),
    dropped: [],
    protected: [],
    warnings: [],
  }
}

/**
 * 按策略清理旧快照。删除前必须校验 sha256：
 * - 旁车缺失或对不上 → 保留 + 告警（留着以后人工核对，不赌）；
 * - dryRun 只算不动。
 */
export function retainBackups(
  backupDir: string,
  nowMs: number,
  policy: BackupPolicy = DEFAULT_BACKUP_POLICY,
  dryRun = false,
): RetentionSummary {
  const entries = listBackups(backupDir)
  const plan = planRetention(entries, nowMs, policy)
  const summary = summarize(plan)
  for (const entry of plan.drop) {
    const verified = readChecksumSidecar(entry.path, entry.name)
    if (!verified) {
      summary.protected.push(entry.name)
      summary.warnings.push(`checksum_unverified:${entry.name}`)
      continue
    }
    if (dryRun) {
      summary.dropped.push(entry.name)
      continue
    }
    try {
      rmSync(entry.path, { force: true })
      rmSync(checksumPath(entry.path), { force: true })
      summary.dropped.push(entry.name)
    } catch (error) {
      summary.protected.push(entry.name)
      summary.warnings.push(`delete_failed:${entry.name}:${String(error)}`)
    }
  }
  return summary
}

export interface CreateBackupOptions {
  dbPath: string
  backupDir: string
  now?: number
  reason?: BackupReason
  policy?: BackupPolicy
  /** 默认 true：生成快照后顺手做保留清理。 */
  retain?: boolean
}

export interface BackupResult {
  ok: true
  file: string
  path: string
  bytes: number
  sha256: string
  integrity: string
  createdAt: number
  reason: BackupReason
  retention: RetentionSummary
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0')
}

/** 文件名里的时间戳：服务器本地时区（03:00 就是本地 03:00，运维看文件名不会算错）。 */
export function backupStamp(nowMs: number): string {
  const date = new Date(nowMs)
  const datePart = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
  const timePart = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  return `${datePart}-${timePart}`
}

export function createBackup(options: CreateBackupOptions): BackupResult {
  const { dbPath, backupDir } = options
  if (!dbPath || dbPath === ':memory:') {
    throw new Error('DB_PATH 指向内存库，无法生成文件快照。')
  }
  if (!existsSync(dbPath)) {
    throw new Error(`数据库文件不存在：${dbPath}`)
  }
  const nowMs = options.now ?? Date.now()
  const reason: BackupReason = options.reason ?? 'manual'
  const policy = options.policy ?? DEFAULT_BACKUP_POLICY
  mkdirSync(backupDir, { recursive: true, mode: 0o750 })

  const name = `persist-${backupStamp(nowMs)}-${reason}.sqlite`
  const target = join(backupDir, name)
  if (existsSync(target)) {
    throw new Error(`快照文件已存在，拒绝覆盖：${target}`)
  }

  // 源库用同一驱动打开；VACUUM INTO 会包含 WAL 里尚未 checkpoint 的内容，
  // 这是它比 cp 文件更可靠的地方。
  const source = openDatabase({ path: dbPath })
  try {
    source.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`)
  } finally {
    source.close()
  }

  const integrity = integrityCheck(target)
  if (integrity !== 'ok') {
    // 坏快照不留：留着只会让人误以为有可用备份。
    rmSync(target, { force: true })
    throw new Error(`快照完整性校验失败：${integrity}`)
  }
  const sha256 = sha256File(target)
  writeChecksumSidecar(target, name, sha256)
  const bytes = statSync(target).size

  const retention =
    options.retain === false
      ? { kept: [], dropped: [], protected: [], warnings: [] }
      : retainBackups(backupDir, nowMs, policy, false)

  return {
    ok: true,
    file: name,
    path: target,
    bytes,
    sha256,
    integrity,
    createdAt: nowMs,
    reason,
    retention,
  }
}

export interface BackupPreview {
  backupDir: string
  count: number
  entries: Array<{ name: string; bytes: number; ageDays: number; action: 'keep' | 'drop' }>
  policy: BackupPolicy
}

/** 只读预演：不生成快照、不删文件，用于上线前确认保留规则。 */
export function previewBackups(
  backupDir: string,
  nowMs: number,
  policy: BackupPolicy = DEFAULT_BACKUP_POLICY,
): BackupPreview {
  const entries = listBackups(backupDir)
  const plan = planRetention(entries, nowMs, policy)
  const today = startOfLocalDay(nowMs)
  return {
    backupDir,
    count: entries.length,
    policy,
    entries: entries.map((entry) => ({
      name: entry.name,
      bytes: entry.bytes,
      ageDays: Math.round((today - startOfLocalDay(entry.createdAt)) / DAY_MS),
      action: plan.drop.some((candidate) => candidate.name === entry.name) ? 'drop' : 'keep',
    })),
  }
}
