import { loadConfig } from '../config.js'
import { parseBackupArgs } from './backup-args.js'
import {
  createBackup,
  previewBackups,
  type BackupPolicy,
  type BackupResult,
  type BackupPreview,
} from './backup.js'

/**
 * 备份命令行入口（由 systemd timer 调用，也可以手动跑）。
 *
 * 用法：
 *   node dist/db/backup-cli.js                       # 生成每日快照 + 保留清理
 *   node dist/db/backup-cli.js --reason manual       # 手动触发，文件名带 manual
 *   node dist/db/backup-cli.js --dry-run             # 只预演保留规则，不生成、不删除
 *
 * 输出一行 JSON，方便 journalctl 直接看，也方便以后接监控。
 * 任何失败都以退出码 1 结束——systemd 会把 oneshot 标成 failed，能被 `systemctl --failed` 看到。
 */

function policyOf(config: ReturnType<typeof loadConfig>): BackupPolicy {
  return {
    keepDays: config.backupKeepDays,
    keepWeeks: config.backupKeepWeeks,
    keepMonths: config.backupKeepMonths,
  }
}

function main(): number {
  const args = parseBackupArgs(process.argv.slice(2))
  const config = loadConfig()
  const policy = policyOf(config)
  const nowMs = Date.now()

  if (args.dryRun) {
    const preview: BackupPreview = previewBackups(config.backupDir, nowMs, policy)
    console.log(JSON.stringify({ ok: true, dryRun: true, ...preview }, null, 0))
    return 0
  }

  const result: BackupResult = createBackup({
    dbPath: config.dbPath,
    backupDir: config.backupDir,
    now: nowMs,
    reason: args.reason,
    policy,
  })
  console.log(JSON.stringify(result, null, 0))
  return 0
}

try {
  process.exitCode = main()
} catch (error) {
  console.error(
    JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    }),
  )
  process.exitCode = 1
}
