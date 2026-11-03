import { describe, expect, it } from 'vitest'
import { createCompleteMockData } from '../data/complete-mock-data'
import type { ImportableMockData, MockSnapshot } from '../types'
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
  it('写入固定主键、当前结构版本，并复用 0.2.0 备份格式', () => {
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
