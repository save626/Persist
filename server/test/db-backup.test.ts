import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  backupStamp,
  checksumPath,
  createBackup,
  DEFAULT_BACKUP_POLICY,
  integrityCheck,
  listBackups,
  parseBackupName,
  planRetention,
  previewBackups,
  retainBackups,
  sha256File,
  writeChecksumSidecar,
  type BackupEntry,
} from '../src/db/backup.js'
import { openDatabase } from '../src/db/driver.js'

const DAY_MS = 86_400_000
/** 固定「现在」= 2026-11-06 19:00 UTC（周五），所有断言都不依赖运行时时钟。 */
const NOW = Date.UTC(2026, 10, 6, 19, 0, 0)

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'persist-backup-'))
  tempDirs.push(dir)
  return dir
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** 造一个「N 天前 03:00」的规范文件名，走真实解析而不是手搓 BackupEntry。 */
function entryFor(daysAgo: number, reason = 'scheduled'): BackupEntry {
  const date = new Date(NOW - daysAgo * DAY_MS)
  const name = `persist-${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}-030000-${reason}.sqlite`
  const parsed = parseBackupName(name)
  if (!parsed) throw new Error(`测试文件名解析失败：${name}`)
  return parsed
}

/** 造一个真实可校验的旧快照（内容不重要，保留清理只看旁车 sha256）。 */
function plantBackup(backupDir: string, daysAgo: number, withChecksum = true): string {
  const entry = entryFor(daysAgo)
  mkdirSync(backupDir, { recursive: true })
  const path = join(backupDir, entry.name)
  writeFileSync(path, `snapshot-${entry.name}`)
  if (withChecksum) writeChecksumSidecar(path, entry.name, sha256File(path))
  return path
}

function seedDatabase(path: string): void {
  const db = openDatabase({ path })
  try {
    db.exec('CREATE TABLE probe (id INTEGER PRIMARY KEY, note TEXT NOT NULL)')
    db.prepare('INSERT INTO probe (note) VALUES (?)').run('hello-backup')
  } finally {
    db.close()
  }
}

describe('备份文件名解析：', () => {
  it('能解出时间、周桶与月桶：', () => {
    const entry = parseBackupName('persist-20261106-030000-scheduled.sqlite')
    expect(entry).not.toBeNull()
    expect(entry?.createdAt).toBe(Date.UTC(2026, 10, 6, 3, 0, 0))
    expect(entry?.weekKey).toBe('2026-11-02')
    expect(entry?.monthKey).toBe('2026-11')
  })

  it('不认的名字一律返回 null，不抛错：', () => {
    for (const name of [
      'persist.sqlite',
      'persist-20261106-030000.sqlite',
      'persist-2026-11-06-030000-scheduled.sqlite',
      'persist-20261106-030000-scheduled.sqlite.sha256',
      'persist-20261106-030000-scheduled.sqlite.tmp',
      'note.txt',
    ]) {
      expect(parseBackupName(name)).toBeNull()
    }
  })
})

describe('保留策略规划：', () => {
  it('近 7 天的快照全部保留，之后按周/月各留一份：', () => {
    const entries = Array.from({ length: 10 }, (_, index) => entryFor(index))
    const plan = planRetention(entries, NOW, DEFAULT_BACKUP_POLICY)
    const kept = new Set(plan.keep.map((entry) => entry.name))

    // 0–6 天进日备份；第 7 天（10-30）是那一周最新的一份进周备份；
    // 第 8 天（10-29）在同一个周桶里，只能靠月备份留下；第 9 天（10-28）三条都不满足 → 删。
    for (let daysAgo = 0; daysAgo <= 6; daysAgo += 1) {
      expect(kept.has(entryFor(daysAgo).name)).toBe(true)
      expect(plan.reasons[entryFor(daysAgo).name]).toBe('daily')
    }
    expect(plan.reasons[entryFor(7).name]).toBe('weekly')
    expect(plan.reasons[entryFor(8).name]).toBe('monthly')
    expect(kept.has(entryFor(9).name)).toBe(false)
    expect(plan.keep).toHaveLength(9)
    expect(plan.drop).toHaveLength(1)
  })

  it('超出窗口的按周/月收敛，且最新一份必留：', () => {
    const entries = Array.from({ length: 200 }, (_, index) => entryFor(index))
    const plan = planRetention(entries, NOW, DEFAULT_BACKUP_POLICY)
    const kept = new Set(plan.keep.map((entry) => entry.name))

    // 7 天日备份 + ≤4 周 + ≤3 月 + 兜底，不超过 15 份（200 天的输入必然大量删除）。
    expect(plan.keep.length).toBeLessThanOrEqual(15)
    expect(plan.drop.length).toBeGreaterThan(180)
    for (let daysAgo = 0; daysAgo < 7; daysAgo += 1) {
      expect(kept.has(entryFor(daysAgo).name)).toBe(true)
    }
    // 超过 3 个月（31×3=93 天）的快照一定被删。
    for (let daysAgo = 93; daysAgo < 200; daysAgo += 1) {
      expect(kept.has(entryFor(daysAgo).name)).toBe(false)
    }
  })

  it('策略全配 0 时只留最新一份，不会删成空目录：', () => {
    const entries = [entryFor(0), entryFor(30), entryFor(60)]
    const plan = planRetention(entries, NOW, { keepDays: 0, keepWeeks: 0, keepMonths: 0 })
    expect(plan.keep).toHaveLength(1)
    expect(plan.keep[0]?.name).toBe(entryFor(0).name)
    expect(plan.reasons[entryFor(0).name]).toBe('newest')
    expect(plan.drop).toHaveLength(2)
  })

  it('空目录规划出空结果：', () => {
    const plan = planRetention([], NOW, DEFAULT_BACKUP_POLICY)
    expect(plan.keep).toHaveLength(0)
    expect(plan.drop).toHaveLength(0)
  })
})

describe('生成快照：', () => {
  it('产物完整、可校验、可直接打开：', () => {
    const dir = tempDir()
    const dbPath = join(dir, 'persist.sqlite')
    seedDatabase(dbPath)
    const backupDir = join(dir, 'backups')

    const result = createBackup({ dbPath, backupDir, now: NOW, reason: 'manual' })

    expect(result.ok).toBe(true)
    expect(result.file).toBe(`persist-${backupStamp(NOW)}-manual.sqlite`)
    expect(result.integrity).toBe('ok')
    expect(result.bytes).toBeGreaterThan(0)
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(sha256File(result.path)).toBe(result.sha256)
    // 旁车用 sha256sum 的格式，运维可以直接 -c 校验
    expect(readFileSync(checksumPath(result.path), 'utf8').trim()).toBe(
      `${result.sha256}  ${result.file}`,
    )

    const snapshot = openDatabase({ path: result.path })
    try {
      const row = snapshot.prepare<{ note: string }>('SELECT note FROM probe').get()
      expect(row?.note).toBe('hello-backup')
    } finally {
      snapshot.close()
    }
    expect(integrityCheck(result.path)).toBe('ok')
  })

  it('库文件不存在时报错，不留下半个快照：', () => {
    const dir = tempDir()
    expect(() =>
      createBackup({
        dbPath: join(dir, 'missing.sqlite'),
        backupDir: join(dir, 'backups'),
        now: NOW,
      }),
    ).toThrow(/数据库文件不存在/)
    expect(existsSync(join(dir, 'backups'))).toBe(false)
  })

  it('内存库拒绝生成快照：', () => {
    const dir = tempDir()
    expect(() => createBackup({ dbPath: ':memory:', backupDir: dir, now: NOW })).toThrow(/内存库/)
  })
})

describe('保留清理：', () => {
  it('只删校验通过的旧快照，缺旁车的保留并告警：', () => {
    const dir = tempDir()
    const dbPath = join(dir, 'persist.sqlite')
    seedDatabase(dbPath)
    const backupDir = join(dir, 'backups')
    createBackup({ dbPath, backupDir, now: NOW, reason: 'scheduled', retain: false })

    const verifiedOld = plantBackup(backupDir, 200, true)
    const unverifiedOld = plantBackup(backupDir, 201, false)

    const summary = retainBackups(backupDir, NOW, DEFAULT_BACKUP_POLICY)

    expect(summary.dropped).toContain(verifiedOld.split(/[\\/]/).pop())
    expect(summary.protected).toContain(unverifiedOld.split(/[\\/]/).pop())
    expect(summary.warnings.some((item) => item.startsWith('checksum_unverified:'))).toBe(true)
    expect(existsSync(verifiedOld)).toBe(false)
    expect(existsSync(checksumPath(verifiedOld))).toBe(false)
    expect(existsSync(unverifiedOld)).toBe(true)
  })

  it('dryRun 只预演，不动文件：', () => {
    const dir = tempDir()
    const dbPath = join(dir, 'persist.sqlite')
    seedDatabase(dbPath)
    const backupDir = join(dir, 'backups')
    const fresh = createBackup({ dbPath, backupDir, now: NOW, reason: 'scheduled', retain: false })
    const oldPath = plantBackup(backupDir, 200, true)
    const oldName = oldPath.split(/[\\/]/).pop()

    const preview = previewBackups(backupDir, NOW, DEFAULT_BACKUP_POLICY)
    expect(preview.count).toBe(2)
    expect(preview.entries.find((entry) => entry.name === oldName)?.action).toBe('drop')

    const summary = retainBackups(backupDir, NOW, DEFAULT_BACKUP_POLICY, true)
    expect(summary.dropped).toEqual([oldName])
    expect(existsSync(oldPath)).toBe(true)
    expect(existsSync(fresh.path)).toBe(true)
  })

  it('唯一一份旧快照按「最新一份必留」兜底，不会被删光：', () => {
    const dir = tempDir()
    const backupDir = join(dir, 'backups')
    const oldPath = plantBackup(backupDir, 400, true)

    const summary = retainBackups(backupDir, NOW, DEFAULT_BACKUP_POLICY)

    expect(summary.dropped).toHaveLength(0)
    expect(existsSync(oldPath)).toBe(true)
  })

  it('生成快照时会顺带清掉过期旧文件：', () => {
    const dir = tempDir()
    const dbPath = join(dir, 'persist.sqlite')
    seedDatabase(dbPath)
    const backupDir = join(dir, 'backups')
    const oldPath = plantBackup(backupDir, 200, true)

    const result = createBackup({ dbPath, backupDir, now: NOW, reason: 'scheduled' })

    expect(result.retention.dropped).toHaveLength(1)
    expect(existsSync(oldPath)).toBe(false)
    expect(listBackups(backupDir).map((entry) => entry.name)).toEqual([result.file])
  })
})
