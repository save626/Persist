import type { BackupReason } from './backup.js'

/**
 * 备份 CLI 的参数解析。
 *
 * 单独抽出来是为了能测：`backup-cli.ts` 顶层就有副作用（真的会生成快照），
 * 没法在测试里 import。这里只做纯解析，两种写法都接受：
 *   --reason manual
 *   --reason=manual
 *
 * 之所以两种都接受：systemd unit 里写的是空格形式，而参数被悄悄忽略过一次
 * （`--reason manual` 落成了 `scheduled` 文件名），所以宁可显式报错也不要静默兜底。
 */

export interface BackupArgs {
  dryRun: boolean
  reason: BackupReason
}

const REASONS: readonly BackupReason[] = ['scheduled', 'manual', 'pre-restore']

function toReason(value: string): BackupReason {
  const found = REASONS.find((reason) => reason === value)
  if (!found) {
    throw new Error(`--reason 只支持 scheduled / manual / pre-restore，收到：${value}`)
  }
  return found
}

export function parseBackupArgs(argv: readonly string[]): BackupArgs {
  let dryRun = false
  let reason: BackupReason = 'scheduled'

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === undefined) continue

    if (arg === '--dry-run') {
      dryRun = true
      continue
    }

    if (arg === '--reason') {
      const value = argv[index + 1]
      if (value === undefined) {
        throw new Error('--reason 后面要跟一个值：scheduled / manual / pre-restore')
      }
      reason = toReason(value)
      index += 1
      continue
    }

    if (arg.startsWith('--reason=')) {
      reason = toReason(arg.slice('--reason='.length))
      continue
    }

    throw new Error(`不认识的参数：${arg}`)
  }

  return { dryRun, reason }
}
