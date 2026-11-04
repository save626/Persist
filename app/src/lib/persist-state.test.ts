import { describe, expect, it } from 'vitest'
import { createCompleteMockData } from '../data/complete-mock-data'
import type { ImportableMockData, MockSnapshot } from '../types'
import { todayDateKey } from './history'
import { PERSIST_BACKUP_VERSION, serializeMockBackup } from './mock-data-transfer'
import {
  createPersistedStateRecord,
  migratePersistedStateRecord,
  PERSIST_STATE_RECORD_ID,
  PERSIST_STATE_SCHEMA_VERSION,
  readPersistedSchemaVersion,
  readPersistedState,
  type PersistedStateRecord,
} from './persist-state'

const SAVED_AT = new Date(Date.UTC(2026, 10, 2, 3, 4, 5))
const DATA_NOW = new Date(2026, 10, 2, 9, 0, 0)

function sampleData(): ImportableMockData {
  return createCompleteMockData(DATA_NOW)
}

function sampleSnapshot(): MockSnapshot {
  return {
    id: 'snapshot-1',
    createdAt: SAVED_AT.toISOString(),
    recordCount: 42,
  }
}

/** 模拟 IndexedDB 的结构化克隆：只保留 JSON 可表达的值。 */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** 校验后的数据会把缺省的 longTermPlans 补成空数组。 */
function expectedData(): ImportableMockData {
  return clone({ ...sampleData(), longTermPlans: [] })
}

function record(): PersistedStateRecord {
  return createPersistedStateRecord(sampleData(), sampleSnapshot(), SAVED_AT)
}

describe('createPersistedStateRecord', () => {
  it('写入固定主键、当前结构版本，并复用 0.3.0 备份格式', () => {
    const state = record()

    expect(state.id).toBe(PERSIST_STATE_RECORD_ID)
    expect(state.schemaVersion).toBe(PERSIST_STATE_SCHEMA_VERSION)
    expect(state.savedAt).toBe(SAVED_AT.toISOString())
    expect(state.backup.app).toBe('Persist')
    expect(state.backup.version).toBe(PERSIST_BACKUP_VERSION)
    expect(state.backup.mode).toBe('frontend-mock')
    expect(state.snapshot).toEqual(sampleSnapshot())
  })

  it('没有快照时写 null', () => {
    expect(createPersistedStateRecord(sampleData(), null, SAVED_AT).snapshot).toBeNull()
  })
})

describe('readPersistedState', () => {
  it('写进去再读回来，业务数据与快照完全一致', () => {
    const state = readPersistedState(clone(record()))

    expect(state).not.toBeNull()
    expect(state?.data).toEqual(expectedData())
    expect(state?.snapshot).toEqual(sampleSnapshot())
    expect(state?.savedAt).toBe(SAVED_AT.toISOString())
  })

  it('把没有 schemaVersion 的早期记录迁移到当前版本', () => {
    const legacy = clone(record()) as Partial<PersistedStateRecord>
    delete legacy.schemaVersion

    expect(readPersistedSchemaVersion(legacy)).toBe(0)
    const migrated = migratePersistedStateRecord(legacy)
    expect(migrated?.schemaVersion).toBe(PERSIST_STATE_SCHEMA_VERSION)
    expect(migrated?.savedAt).toBe(SAVED_AT.toISOString())

    const state = readPersistedState(legacy)
    expect(state?.data).toEqual(expectedData())
  })

  it('未来版本的数据不读取，避免旧代码覆盖新格式', () => {
    const future = { ...clone(record()), schemaVersion: PERSIST_STATE_SCHEMA_VERSION + 1 }

    expect(readPersistedSchemaVersion(future)).toBe(PERSIST_STATE_SCHEMA_VERSION + 1)
    expect(migratePersistedStateRecord(future)).toBeNull()
    expect(readPersistedState(future)).toBeNull()
  })

  it('结构版本不是整数时视为损坏', () => {
    expect(readPersistedState({ ...clone(record()), schemaVersion: 1.5 })).toBeNull()
    expect(readPersistedState({ ...clone(record()), schemaVersion: -1 })).toBeNull()
  })

  it('备份数据字段不合法时返回 null 而不是抛错', () => {
    const broken = clone(record())
    delete (broken.backup.data as unknown as Record<string, unknown>).studyRecords

    expect(() => readPersistedState(broken)).not.toThrow()
    expect(readPersistedState(broken)).toBeNull()
  })

  it('快照字段不合法时只丢快照，业务数据仍可用', () => {
    const broken: PersistedStateRecord = clone(record())
    ;(broken as unknown as { snapshot: unknown }).snapshot = {
      id: 'x',
      createdAt: 'y',
      recordCount: 'many',
    }

    const state = readPersistedState(broken)
    expect(state).not.toBeNull()
    expect(state?.snapshot).toBeNull()
    expect(state?.data).toEqual(expectedData())
  })

  it('非对象、空值、缺 backup 的输入一律返回 null', () => {
    for (const raw of [null, undefined, 42, 'persist', [], {}, { schemaVersion: 1 }]) {
      expect(readPersistedState(raw)).toBeNull()
    }
  })

  it('savedAt 缺失时读成空字符串，不影响数据本身', () => {
    const withoutSavedAt = clone(record())
    delete (withoutSavedAt as Partial<PersistedStateRecord>).savedAt

    const state = readPersistedState(withoutSavedAt)
    expect(state?.savedAt).toBe('')
    expect(state?.data).toEqual(expectedData())
  })
})

describe('与导出备份的关系', () => {
  it('serializeMockBackup 与记录里的 backup 是同一结构（本地存储与导出文件同构）', () => {
    const state = record()
    expect(state.backup).toEqual(clone(serializeMockBackup(sampleData(), SAVED_AT)))
  })
})

/** 造一条 v1 记录：备份是 0.2.0 的老形状（计划/饮水无 date、只有当天 meals、没有训练历史）。 */
function legacyV1Record(): PersistedStateRecord {
  const legacy = clone(record()) as unknown as Record<string, unknown>
  legacy.schemaVersion = 1
  const backup = legacy.backup as { version: string; data: Record<string, unknown> }
  backup.version = '0.2.0'
  const data = backup.data
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
  return legacy as unknown as PersistedStateRecord
}

describe('v1 → v2 迁移（8d 数据历史化）', () => {
  const LOCAL_SAVE_DAY = todayDateKey(SAVED_AT)

  it('升级到结构版本 2 与 0.3.0 备份，并补齐日期与历史切片', () => {
    const migrated = migratePersistedStateRecord(legacyV1Record())

    expect(migrated?.schemaVersion).toBe(2)
    const backup = migrated?.backup as unknown as { version: string; data: ImportableMockData }
    expect(backup.version).toBe('0.3.0')
    expect(backup.data.planItems.every((item) => item.date === LOCAL_SAVE_DAY)).toBe(true)
    expect(backup.data.waterLog.every((entry) => entry.date === LOCAL_SAVE_DAY)).toBe(true)
    expect(backup.data.dietDays).toHaveLength(1)
    expect(backup.data.dietDays[0].date).toBe(LOCAL_SAVE_DAY)
    expect(backup.data.fitnessHistory).toEqual([])
    expect('meals' in (backup.data as unknown as Record<string, unknown>)).toBe(false)
  })

  it('迁移日期取保存当天（本地自然日），而不是迁移时刻', () => {
    // 迁移时刻故意给次日：补日期仍应落在 savedAt 的本地自然日上。
    const migrated = migratePersistedStateRecord(
      legacyV1Record(),
      new Date(2026, 10, 3, 9, 0, 0),
    )
    const backup = migrated?.backup as unknown as { data: ImportableMockData }

    expect(LOCAL_SAVE_DAY).toBe('2026-11-02')
    expect(backup.data.dietDays[0].date).toBe(LOCAL_SAVE_DAY)
  })

  it('读回 v1 记录时自动迁移，页面拿到的是新形状', () => {
    const state = readPersistedState(legacyV1Record())

    expect(state?.data.dietDays).toHaveLength(1)
    expect(state?.data.fitnessHistory).toEqual([])
    expect(
      (state?.data.planItems ?? []).every((item) => item.date === LOCAL_SAVE_DAY),
    ).toBe(true)
    // 迁移前不归档：演示数据里的会话本来就是进行中，不属于「已完成但没进历史」。
    expect(state?.data.fitnessSession?.sessionStatus).toBe('active')
  })

  it('v1 里已完成但没进历史的会话，迁移时归档到当天并清空会话', () => {
    const legacy = legacyV1Record()
    const legacyData = legacy.backup.data as unknown as Record<string, unknown>
    legacyData.fitnessSession = {
      ...(legacyData.fitnessSession as Record<string, unknown>),
      sessionStatus: 'completed',
    }

    const state = readPersistedState(legacy)

    expect(state?.data.fitnessSession).toBeNull()
    expect(state?.data.fitnessHistory).toHaveLength(1)
    expect(state?.data.fitnessHistory[0].date).toBe(LOCAL_SAVE_DAY)
    expect(state?.data.fitnessHistory[0].id).toBe(`workout-legacy-${Date.parse(SAVED_AT.toISOString())}`)
  })

  it('已经是 v2 形状的 v1 记录迁移后数据不变，不会重复补日期', () => {
    const current = clone(record()) as unknown as Record<string, unknown>
    current.schemaVersion = 1
    const before = clone(current.backup)

    const migrated = migratePersistedStateRecord(current as unknown as PersistedStateRecord)

    expect(migrated?.schemaVersion).toBe(2)
    expect(migrated?.backup).toEqual(before)
  })

  it('不修改传入的旧记录（迁移是纯函数）', () => {
    const legacy = legacyV1Record()
    const snapshot = clone(legacy)

    migratePersistedStateRecord(legacy)

    expect(legacy).toEqual(snapshot)
  })

  it('损坏的 v1 记录仍然返回 null，迁移不放宽校验', () => {
    const broken = legacyV1Record()
    delete (broken.backup.data as unknown as Record<string, unknown>).studyRecords

    expect(readPersistedState(broken)).toBeNull()
  })
})
