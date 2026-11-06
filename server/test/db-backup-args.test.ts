import { describe, expect, it } from 'vitest'

import { parseBackupArgs } from '../src/db/backup-args.js'

describe('备份 CLI 参数解析', () => {
  it('不带参数时默认 scheduled 且真正生成快照', () => {
    expect(parseBackupArgs([])).toEqual({ dryRun: false, reason: 'scheduled' })
  })

  it('空格形式与等号形式都能识别 --reason', () => {
    expect(parseBackupArgs(['--reason', 'manual'])).toEqual({ dryRun: false, reason: 'manual' })
    expect(parseBackupArgs(['--reason=manual'])).toEqual({ dryRun: false, reason: 'manual' })
    expect(parseBackupArgs(['--reason', 'pre-restore'])).toEqual({
      dryRun: false,
      reason: 'pre-restore',
    })
  })

  it('--dry-run 与 --reason 可以混用，顺序无关', () => {
    expect(parseBackupArgs(['--dry-run', '--reason', 'manual'])).toEqual({
      dryRun: true,
      reason: 'manual',
    })
    expect(parseBackupArgs(['--reason=manual', '--dry-run'])).toEqual({
      dryRun: true,
      reason: 'manual',
    })
  })

  it('非法的 reason 会直接报错，不会静默退回 scheduled', () => {
    expect(() => parseBackupArgs(['--reason', 'restore'])).toThrow(
      /--reason 只支持 scheduled \/ manual \/ pre-restore，收到：restore/,
    )
    expect(() => parseBackupArgs(['--reason='])).toThrow(/收到：$/)
  })

  it('--reason 缺值或不认识的参数会报错', () => {
    expect(() => parseBackupArgs(['--reason'])).toThrow(/--reason 后面要跟一个值/)
    expect(() => parseBackupArgs(['--verbose'])).toThrow(/不认识的参数：--verbose/)
  })
})
