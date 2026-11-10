import { describe, expect, it } from 'vitest'
import { createCompleteMockData } from '../data/complete-mock-data'
import {
  PERSIST_EXPORT_MODE,
  PERSIST_EXPORT_SCHEMA_VERSION,
  PERSIST_EXPORT_VERSION,
} from '@persist/shared/contract/export'
import type { ImportableMockData, LongTermPlan } from '../types'
import { createLongTermPlan } from './long-term-plan'
import {
  countMockRecords,
  LEGACY_BACKUP_VERSION,
  normalizeBackupVersion,
  parseMockBackupJson,
  parseMockBackupValue,
  PERSIST_BACKUP_VERSION,
  PRE_HISTORY_BACKUP_VERSION,
  readMockBackupVersion,
  serializeMockBackup,
  upgradeMockBackupData,
  upgradeMockBackupPayload,
} from './mock-data-transfer'

const EXPORTED_AT = new Date(Date.UTC(2026, 10, 2, 3, 4, 5))
const DATA_NOW = new Date(2026, 10, 2, 9, 0, 0)

function plan(overrides: Partial<LongTermPlan> = {}): LongTermPlan {
  return {
    id: 'plan-1',
    title: '12 周减脂',
    goal: '把体重降到 70kg',
    startDate: '2026-11-02',
    endDate: '2027-01-25',
    cadence: 'cycle',
    weeklyTargets: [
      { id: 'target-1', label: '力量训练', unit: '次', perWeek: 4, module: 'fitness' },
      { id: 'target-2', label: '英语精听', unit: '篇', perWeek: 3, module: 'study' },
      { id: 'target-3', label: '有氧', unit: '分钟', perWeek: 150 },
    ],
    milestones: [{ date: '2026-12-01', label: '第一次复查', metric: '体重 ≤ 75kg' }],
    status: 'active',
    source: 'ai-chat',
    createdAt: EXPORTED_AT.toISOString(),
    ...overrides,
  }
}

function dataWithPlans(plans: LongTermPlan[] = [plan()]): ImportableMockData {
  return { ...createCompleteMockData(DATA_NOW), longTermPlans: plans }
}

/** 故意放进去非法计划时用：类型层已经不允许，测试里直接按 unknown 注入。 */
function dataWithRawPlans(plans: unknown): ImportableMockData {
  return { ...createCompleteMockData(DATA_NOW), longTermPlans: plans as LongTermPlan[] }
}

function backupObject(data: ImportableMockData) {
  return JSON.parse(JSON.stringify(serializeMockBackup(data, EXPORTED_AT))) as {
    app: string
    version: string
    mode: string
    exportedAt: string
    data: Record<string, unknown>
  }
}

function textWithPlans(plans: unknown) {
  const payload = backupObject(dataWithPlans())
  payload.data.longTermPlans = plans
  return JSON.stringify(payload)
}

describe('serializeMockBackup 序列化', () => {
  it('写入固定版本号、来源标记与传入的导出时间', () => {
    const payload = serializeMockBackup(dataWithPlans(), EXPORTED_AT)

    expect(payload.app).toBe('Persist')
    expect(payload.version).toBe(PERSIST_BACKUP_VERSION)
    expect(payload.version).toBe('0.3.0')
    expect(payload.mode).toBe('frontend-mock')
    expect(payload.exportedAt).toBe(EXPORTED_AT.toISOString())
  })

  it('不传导出时间时使用当前时刻的 ISO 字符串', () => {
    const payload = serializeMockBackup(dataWithPlans())

    expect(payload.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    expect(Number.isNaN(Date.parse(payload.exportedAt))).toBe(false)
  })

  it('保持 0.3.0 的切片顺序，并把 longTermPlans 追加在 data 末尾', () => {
    const payload = serializeMockBackup(dataWithPlans(), EXPORTED_AT)

    expect(Object.keys(payload.data)).toEqual([
      'goals',
      'planItems',
      'waterLog',
      'studyRecords',
      'dietDays',
      'fitnessSession',
      'fitnessHistory',
      'profile',
      'settings',
      'aiConsent',
      'eveningReview',
      'reports',
      'longTermPlans',
    ])
  })

  it('原样保留长期计划的里程碑、单位与模块', () => {
    const payload = serializeMockBackup(dataWithPlans(), EXPORTED_AT)
    const [saved] = payload.data.longTermPlans

    expect(payload.data.longTermPlans).toEqual([plan()])
    expect(saved.milestones?.[0]).toEqual({
      date: '2026-12-01',
      label: '第一次复查',
      metric: '体重 ≤ 75kg',
    })
    expect(saved.weeklyTargets[1]).toMatchObject({ unit: '篇', module: 'study' })
    expect(saved.weeklyTargets[2].module).toBeUndefined()
  })

  it('数据里没有长期计划时显式写成空数组', () => {
    const payload = serializeMockBackup(createCompleteMockData(DATA_NOW), EXPORTED_AT)

    expect(payload.data.longTermPlans).toEqual([])
  })

  it('计划非法时拒绝导出并指出具体字段', () => {
    const data = dataWithRawPlans([
      { ...plan(), weeklyTargets: [{ id: 'target-1', label: '深蹲', unit: '次', perWeek: 0 }] },
    ])

    expect(() => serializeMockBackup(data, EXPORTED_AT)).toThrow(
      '导出数据中的第 1 个长期计划格式不正确：weeklyTargets[0].perWeek 需要在 1–999 之间。',
    )
  })
})

describe('导出 → 导入 往返', () => {
  it('接受服务端 0.3.0 导出信封，并允许空报告数组', () => {
    const data: ImportableMockData = { ...createCompleteMockData(DATA_NOW), reports: [] }
    const parsed = parseMockBackupValue({
      app: 'Persist',
      version: PERSIST_EXPORT_VERSION,
      mode: PERSIST_EXPORT_MODE,
      schemaVersion: PERSIST_EXPORT_SCHEMA_VERSION,
      exportedAt: EXPORTED_AT.toISOString(),
      data,
    })

    expect(parsed.reports).toEqual([])
    expect(parsed.profile).toEqual(data.profile)
    expect(parsed.longTermPlans).toEqual(data.longTermPlans ?? [])
  })
  it('整份备份往返后所有切片、计划状态与记录计数保持一致', () => {
    const data = dataWithPlans()
    const parsed = parseMockBackupJson(JSON.stringify(serializeMockBackup(data, EXPORTED_AT)))

    expect(parsed).toEqual(data)
    expect(parsed.longTermPlans).toEqual(data.longTermPlans)
    expect(parsed.longTermPlans?.[0].status).toBe('active')
    expect(countMockRecords(parsed)).toBe(countMockRecords(data))
  })

  it('长期计划连同里程碑、单位、模块一起还原', () => {
    const parsed = parseMockBackupJson(
      JSON.stringify(serializeMockBackup(dataWithPlans(), EXPORTED_AT)),
    )

    expect(parsed.longTermPlans).toEqual([plan()])
    expect(parsed.longTermPlans?.[0].weeklyTargets).toHaveLength(3)
    expect(parsed.longTermPlans?.[0].milestones?.[0].metric).toBe('体重 ≤ 75kg')
  })

  it('接受 createLongTermPlan 真实产出的计划（createdAt 是 ISO 时间串）', () => {
    const created = createLongTermPlan(
      {
        title: '英语冲刺',
        goal: '每天精听一篇',
        cadence: 'weekly',
        startDate: '2026-11-02',
        endDate: '2026-12-28',
        weeklyTargets: [{ label: '精听', unit: '篇', perWeek: 7, module: 'study' }],
        milestones: [{ date: '2026-12-01', label: '第一次复盘' }],
      },
      EXPORTED_AT,
    )
    expect(created).not.toBeNull()

    const parsed = parseMockBackupJson(
      JSON.stringify(serializeMockBackup(dataWithPlans([created as LongTermPlan]), EXPORTED_AT)),
    )

    expect(parsed.longTermPlans).toEqual([created])
  })

  it('0.1.0 旧备份缺少 longTermPlans 时按空数组导入', () => {
    const payload = backupObject(dataWithPlans())
    payload.version = LEGACY_BACKUP_VERSION
    delete payload.data.longTermPlans

    const parsed = parseMockBackupJson(JSON.stringify(payload))

    expect(parsed.longTermPlans).toEqual([])
  })

  it('longTermPlans 为 null 时同样按空数组导入', () => {
    const parsed = parseMockBackupJson(textWithPlans(null))

    expect(parsed.longTermPlans).toEqual([])
  })

  it('版本号缺失时照常导入（不做版本门禁）', () => {
    const payload = backupObject(dataWithPlans())
    delete (payload as { version?: string }).version

    const parsed = parseMockBackupJson(JSON.stringify(payload))

    expect(parsed.longTermPlans).toHaveLength(1)
  })
})

describe('parseMockBackupJson 拒绝非法长期计划', () => {
  it('longTermPlans 不是数组时报错', () => {
    expect(() => parseMockBackupJson(textWithPlans({}))).toThrow(
      '备份中的长期计划格式不正确：longTermPlans 必须是数组',
    )
  })

  it('cadence 非法时报错', () => {
    expect(() => parseMockBackupJson(textWithPlans([{ ...plan(), cadence: 'monthly' }]))).toThrow(
      'cadence 只能是 weekly 或 cycle',
    )
  })

  it('perWeek 为 0 时报错并指出下标', () => {
    const bad = [
      { ...plan(), weeklyTargets: [{ id: 't1', label: '深蹲', unit: '次', perWeek: 0 }] },
    ]

    expect(() => parseMockBackupJson(textWithPlans(bad))).toThrow(
      'weeklyTargets[0].perWeek 需要在 1–999 之间',
    )
  })

  it('perWeek 超过 999 时报错', () => {
    const bad = [
      { ...plan(), weeklyTargets: [{ id: 't1', label: '深蹲', unit: '次', perWeek: 1000 }] },
    ]

    expect(() => parseMockBackupJson(textWithPlans(bad))).toThrow(
      'weeklyTargets[0].perWeek 需要在 1–999 之间',
    )
  })

  it('日期不存在（2026-13-01）时报错', () => {
    expect(() =>
      parseMockBackupJson(textWithPlans([{ ...plan(), startDate: '2026-13-01' }])),
    ).toThrow('startDate 必须是合法的 YYYY-MM-DD 日期')
  })

  it('startDate 晚于 endDate 时报错', () => {
    const bad = [{ ...plan(), startDate: '2027-02-01', endDate: '2027-01-01' }]

    expect(() => parseMockBackupJson(textWithPlans(bad))).toThrow('startDate 不能晚于 endDate')
  })

  it('weeklyTargets 为空数组时报错', () => {
    expect(() => parseMockBackupJson(textWithPlans([{ ...plan(), weeklyTargets: [] }]))).toThrow(
      'weeklyTargets 至少需要 1 个周目标',
    )
  })

  it('里程碑日期不是 YYYY-MM-DD 时报错并定位到 milestones 下标', () => {
    const bad = [{ ...plan(), milestones: [{ date: '2026/12/01', label: '第一次复查' }] }]

    expect(() => parseMockBackupJson(textWithPlans(bad))).toThrow(
      'milestones[0].date 必须是合法的 YYYY-MM-DD 日期',
    )
  })

  it('第 2 条计划非法时错误信息带上序号', () => {
    const bad = [plan(), { ...plan(), id: 'plan-2', status: 'paused' }]

    expect(() => parseMockBackupJson(textWithPlans(bad))).toThrow('第 2 个长期计划格式不正确')
  })

  it('计划不是对象时报错', () => {
    expect(() => parseMockBackupJson(textWithPlans(['plan-1']))).toThrow(
      '第 1 个长期计划格式不正确：每一项都必须是 JSON 对象',
    )
  })
})

describe('countMockRecords 统计长期计划', () => {
  it('每多一条长期计划，统计结果 +1', () => {
    const base = createCompleteMockData(DATA_NOW)
    const withTwo = dataWithPlans([plan(), plan({ id: 'plan-2' })])

    expect(countMockRecords(base)).toBeGreaterThan(0)
    expect(countMockRecords(withTwo)).toBe(countMockRecords(base) + 2)
  })

  it('旧数据没有 longTermPlans 字段时按 0 计而不是 NaN', () => {
    const base = createCompleteMockData(DATA_NOW)

    expect(Number.isFinite(countMockRecords(base))).toBe(true)
    expect(countMockRecords({ ...base, longTermPlans: [] })).toBe(countMockRecords(base))
  })
})

const UPGRADE_NOW = new Date(2026, 10, 5, 0, 30)

/**
 * 用当前序列化结果反向造一份 0.2.0 备份：计划/饮水没有 date、饮食只有当天 meals、
 * 没有 fitnessHistory。版本号也一起改回 0.2.0。
 */
function preHistoryPayload(version = PRE_HISTORY_BACKUP_VERSION) {
  const payload = backupObject(dataWithPlans())
  payload.version = version
  const data = payload.data
  const stripDate = (list: unknown) => {
    if (!Array.isArray(list)) return list
    return list.map((item) => {
      const { date: _date, ...rest } = item as Record<string, unknown>
      return rest
    })
  }

  data.planItems = stripDate(data.planItems)
  data.waterLog = stripDate(data.waterLog)
  const dietDays = data.dietDays as Array<{ date: string; meals: unknown }>
  data.meals = dietDays[0]?.meals ?? []
  delete data.dietDays
  delete data.fitnessHistory
  return payload
}

describe('历史化升级：0.2.0 备份补齐日期与历史切片', () => {
  it('缺少 date 的计划与饮水按导入当天补日期，meals 变成一条 dietDays', () => {
    const parsed = parseMockBackupValue(preHistoryPayload(), UPGRADE_NOW)
    const today = '2026-11-05'

    expect(parsed.planItems.every((item) => item.date === today)).toBe(true)
    expect(parsed.waterLog.every((entry) => entry.date === today)).toBe(true)
    expect(parsed.dietDays).toHaveLength(1)
    expect(parsed.dietDays[0].date).toBe(today)
    expect(parsed.dietDays[0].meals).toHaveLength(4)
    expect('meals' in (parsed as unknown as Record<string, unknown>)).toBe(false)
    expect(parsed.fitnessHistory).toEqual([])
  })

  it('升级时用本地自然日，UTC 与本地跨天不会写错日期', () => {
    const parsed = parseMockBackupValue(preHistoryPayload(), new Date(2026, 10, 5, 0, 30))

    expect(parsed.dietDays[0].date).toBe('2026-11-05')
  })

  it('已经是 0.3.0 形状的数据不再补日期、不丢历史', () => {
    const data = dataWithPlans()
    const upgraded = upgradeMockBackupData(data, UPGRADE_NOW) as typeof data

    expect(upgraded.planItems).toEqual(data.planItems)
    expect(upgraded.dietDays).toEqual(data.dietDays)
    expect(upgraded.fitnessHistory).toEqual([])
  })

  it('升级整个负载时把版本号写成 0.3.0', () => {
    const upgraded = upgradeMockBackupPayload(preHistoryPayload(), UPGRADE_NOW) as {
      version: string
      data: Record<string, unknown>
    }

    expect(upgraded.version).toBe('0.3.0')
    expect(parseMockBackupJson(JSON.stringify(upgraded)).dietDays).toHaveLength(1)
  })

  it('0.2.0 备份里的已完成会话在文件导入时保持原样（不擅自归档）', () => {
    const payload = preHistoryPayload()
    ;(payload.data as Record<string, unknown>).fitnessSession = {
      ...(payload.data as { fitnessSession: Record<string, unknown> }).fitnessSession,
      sessionStatus: 'completed',
    }

    const parsed = parseMockBackupValue(payload, UPGRADE_NOW)

    expect(parsed.fitnessSession?.sessionStatus).toBe('completed')
    expect(parsed.fitnessHistory).toEqual([])
  })

  it('本地迁移时把已完成会话归档进历史并清空会话', () => {
    const payload = preHistoryPayload()
    const legacySession = (payload.data as { fitnessSession: Record<string, unknown> })
      .fitnessSession
    ;(payload.data as Record<string, unknown>).fitnessSession = {
      ...legacySession,
      sessionStatus: 'completed',
    }

    const upgraded = upgradeMockBackupData(payload.data, UPGRADE_NOW, {
      archiveCompletedSession: true,
    }) as { fitnessSession: unknown; fitnessHistory: Array<Record<string, unknown>> }

    expect(upgraded.fitnessSession).toBeNull()
    expect(upgraded.fitnessHistory).toHaveLength(1)
    expect(upgraded.fitnessHistory[0].id).toBe(`workout-legacy-${UPGRADE_NOW.getTime()}`)
    expect(upgraded.fitnessHistory[0].date).toBe('2026-11-05')
    expect(upgraded.fitnessHistory[0].completedAt).toBe(UPGRADE_NOW.toISOString())
  })
})

describe('备份版本读取', () => {
  it('readMockBackupVersion 读出归一化版本，解析失败时返回空串', () => {
    const payload = backupObject(dataWithPlans())

    expect(readMockBackupVersion(JSON.stringify(payload))).toBe(PERSIST_BACKUP_VERSION)
    expect(readMockBackupVersion('不是 JSON')).toBe('')
    expect(readMockBackupVersion('[]')).toBe('')
  })

  it('normalizeBackupVersion 只接受字符串并去掉空白', () => {
    expect(normalizeBackupVersion(' 0.1.0 ')).toBe(LEGACY_BACKUP_VERSION)
    expect(normalizeBackupVersion(undefined)).toBe('')
    expect(normalizeBackupVersion(2)).toBe('')
  })
})
