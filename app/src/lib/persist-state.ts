import { createEmptyMockData } from '../data/empty-mock-data'
import type { ImportableMockData, MockSnapshot } from '../types'
import {
  parseMockBackupValue,
  serializeMockBackup,
  PERSIST_BACKUP_VERSION,
  upgradeMockBackupData,
  type PersistBackupPayload,
} from './mock-data-transfer'

/** IndexedDB 里只存一条记录，主键固定，后续迁移只改这条记录的形状。 */
export const PERSIST_STATE_RECORD_ID = 'persist-mock-state'
export const PERSIST_STATE_DB_NAME = 'persist-app'
export const PERSIST_STATE_STORE_NAME = 'mock-state'
/**
 * 本地记录结构版本。改动 `PersistedStateRecord` 的形状就必须 +1，
 * 并在下面的 `MIGRATIONS` 里补一条「从旧版本升到该版本」的纯函数。
 * v2（8d 数据历史化）：计划/饮水带 `date`，饮食升级为按日台账 `dietDays`，
 * 新增 `fitnessHistory`，备份格式同步升到 0.3.0。
 * v3：清除旧版 owner 首次启动写入的样例业务数据，保留用户后来新增的记录。
 */
export const PERSIST_STATE_SCHEMA_VERSION = 3
/** 交互后合并写入的防抖窗口，避免每次输入都开一个 IndexedDB 事务。 */
export const PERSIST_SAVE_DEBOUNCE_MS = 200

/**
 * 本地持久化记录：备份负载 + 快照 + 存储元信息。
 * `backup` 复用导出备份的 0.3.0 结构，因此「本地数据」和「备份文件」走同一套字段校验，
 * 也让后续 P4 的真实备份/恢复可以直接搬运这一层。
 */
export type PersistedStateRecord = {
  id: string
  schemaVersion: number
  savedAt: string
  backup: PersistBackupPayload
  snapshot: MockSnapshot | null
}

export type PersistedState = {
  data: ImportableMockData
  snapshot: MockSnapshot | null
  savedAt: string
}

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const LEGACY_INITIAL_PROFILE = {
  age: 24,
  height: 178,
  weight: 72.5,
  targetWeight: 70,
  goal: '增肌同时改善体态',
  experience: '系统训练 2 年',
  frequency: '每周 4 次',
  equipment: '商业健身房',
  dietPreference: '高蛋白、正常碳水',
  allergies: '',
  bedtime: '',
  sleepHours: 7.2,
  stress: '',
  aiConsent: true,
} as const

const LEGACY_INITIAL_GOALS: Record<string, UnknownRecord> = {
  'goal-1': {
    title: '高数阶段测验',
    date: '2026-11-15',
    time: '19:00',
    enabled: true,
    tone: 'primary',
  },
  'goal-2': {
    title: '英语六级考试',
    date: '2026-12-19',
    time: '09:00',
    enabled: true,
    tone: 'alt',
  },
}

const LEGACY_INITIAL_PLAN_ITEMS: Record<string, UnknownRecord> = {
  morning: {
    name: '早餐与晨间记录',
    time: '08:20',
    detail: '380 kcal · 睡眠 7 小时 10 分',
    kind: 'default',
    done: true,
  },
  lunch: {
    name: '午餐记录',
    time: '12:25',
    detail: '鸡胸肉藜麦碗 · 620 kcal',
    kind: 'food',
    done: true,
  },
  water: {
    name: '午后补水',
    time: '15:40',
    detail: '250 ml · 今日累计 1.2 L',
    kind: 'water',
    done: true,
  },
  training: {
    name: '上肢力量训练',
    time: '18:30',
    detail: '45 分钟 · 胸 / 肩 / 三头',
    kind: 'default',
    done: false,
    actionable: true,
  },
  math: {
    name: '高数：极限与连续',
    time: '20:30',
    detail: '45 分钟 · 练习 12 题',
    kind: 'study',
    done: false,
  },
}

const LEGACY_INITIAL_STUDY_IDS = new Set([
  'study-english-today',
  'study-math-today',
  'study-english-yesterday',
  'study-math-yesterday',
  'study-english-older',
])

const LEGACY_INITIAL_DIET_ENTRY_IDS = new Set([
  'breakfast-oat',
  'breakfast-egg',
  'lunch-chicken',
  'snack-yogurt',
])

const LEGACY_INITIAL_MEAL_TIMES: Record<string, string> = {
  breakfast: '08:35',
  lunch: '12:25',
  dinner: '18:30',
  snack: '15:40',
}

const LEGACY_INITIAL_REPORTS: Record<string, UnknownRecord> = {
  'report-week-current': {
    title: '训练节奏稳定，学习开始出现连续投入',
    date: '10 月 27 日',
    updatedAt: '10 月 27 日 08:10',
    period: '10 月 21 日 — 10 月 27 日',
  },
  'report-fitness-1024': {
    title: '下肢训练后恢复窗口偏短，下次维持容量即可',
    date: '10 月 24 日',
    updatedAt: '10 月 24 日 19:20',
    period: '单次训练复盘',
  },
  'report-study-1025': {
    title: '英语记录更连续，高数需要减少晚间集中',
    date: '10 月 25 日',
    updatedAt: '10 月 25 日 21:10',
    period: '近 7 天学习记录',
  },
  'report-diet-1022': {
    title: '蛋白质分布集中在晚餐，白天摄入偏低',
    date: '10 月 22 日',
    updatedAt: '10 月 22 日 20:40',
    period: '近 7 天饮食记录',
  },
}

function matchesFields(value: unknown, expected: UnknownRecord) {
  return (
    isRecord(value) &&
    Object.entries(expected).every(([key, expectedValue]) => value[key] === expectedValue)
  )
}

function filterLegacyItems(
  value: unknown,
  predicate: (item: unknown) => boolean,
): { value: unknown; changed: boolean } {
  if (!Array.isArray(value)) return { value, changed: false }
  const next = value.filter((item) => !predicate(item))
  return { value: next, changed: next.length !== value.length }
}

function scrubLegacyDietDays(value: unknown): { value: unknown; changed: boolean } {
  if (!Array.isArray(value)) return { value, changed: false }
  let changed = false
  const days = value.map((day) => {
    if (!isRecord(day) || !Array.isArray(day.meals)) return day
    const hasLegacyEntry = day.meals.some(
      (meal) =>
        isRecord(meal) &&
        Array.isArray(meal.entries) &&
        meal.entries.some(
          (entry) => isRecord(entry) && LEGACY_INITIAL_DIET_ENTRY_IDS.has(String(entry.id)),
        ),
    )
    if (!hasLegacyEntry) return day

    changed = true
    return {
      ...day,
      meals: day.meals.map((meal) => {
        if (!isRecord(meal)) return meal
        const entries = Array.isArray(meal.entries)
          ? meal.entries.filter(
              (entry) => !(isRecord(entry) && LEGACY_INITIAL_DIET_ENTRY_IDS.has(String(entry.id))),
            )
          : meal.entries
        const legacyTime = LEGACY_INITIAL_MEAL_TIMES[String(meal.id)]
        return {
          ...meal,
          entries,
          time: legacyTime === meal.time ? '' : meal.time,
        }
      }),
    }
  })
  return { value: days, changed }
}

function isLegacyInitialSettings(value: unknown) {
  if (!isRecord(value) || !Array.isArray(value.reminders) || value.reminders.length !== 3) {
    return false
  }
  const expectedReminders = [
    ['water', '09:00', true],
    ['training', '18:00', true],
    ['review', '21:45', true],
  ] as const
  const sameReminders = value.reminders.every((reminder, index) => {
    const expected = expectedReminders[index]
    return (
      isRecord(reminder) &&
      reminder.id === expected[0] &&
      reminder.time === expected[1] &&
      reminder.enabled === expected[2]
    )
  })
  return (
    sameReminders &&
    value.summaryOnly === true &&
    matchesFields(value.sources, {
      fitness: true,
      diet: true,
      study: true,
      profile: true,
    }) &&
    matchesFields(value.dailyBrief, { enabled: false, at: '21:00' })
  )
}

/**
 * v2 及更早版本的 owner 首次启动会写入一套演示样例。这里只匹配已知指纹，
 * 避免用户后来真实新增或修改的数据被误删；demo 使用不同 ID / 内容，不会命中。
 */
function scrubLegacyInitialSeedData(value: unknown): { value: unknown; changed: boolean } {
  if (!isRecord(value)) return { value, changed: false }
  const empty = createEmptyMockData()
  let changed = false

  const goals = filterLegacyItems(value.goals, (item) => {
    if (!isRecord(item)) return false
    const expected = LEGACY_INITIAL_GOALS[String(item.id)]
    return expected ? matchesFields(item, expected) : false
  })
  changed ||= goals.changed

  const planItems = filterLegacyItems(value.planItems, (item) => {
    if (!isRecord(item)) return false
    const expected = LEGACY_INITIAL_PLAN_ITEMS[String(item.id)]
    return expected ? matchesFields(item, expected) : false
  })
  changed ||= planItems.changed

  const studyRecords = filterLegacyItems(value.studyRecords, (item) => {
    return isRecord(item) && LEGACY_INITIAL_STUDY_IDS.has(String(item.id))
  })
  changed ||= studyRecords.changed

  const dietDays = scrubLegacyDietDays(value.dietDays)
  changed ||= dietDays.changed

  const reports = filterLegacyItems(value.reports, (item) => {
    if (!isRecord(item)) return false
    const expected = LEGACY_INITIAL_REPORTS[String(item.id)]
    return expected ? matchesFields(item, expected) : false
  })
  changed ||= reports.changed

  const profile = matchesFields(value.profile, LEGACY_INITIAL_PROFILE)
    ? empty.profile
    : value.profile
  if (profile !== value.profile) changed = true
  const settings = isLegacyInitialSettings(value.settings) ? empty.settings : value.settings
  if (settings !== value.settings) changed = true

  return {
    value: changed
      ? {
          ...value,
          goals: goals.value,
          planItems: planItems.value,
          studyRecords: studyRecords.value,
          dietDays: dietDays.value,
          profile,
          settings,
          reports: reports.value,
        }
      : value,
    changed,
  }
}

function isMockSnapshot(value: unknown): value is MockSnapshot {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.createdAt === 'string' &&
    typeof value.recordCount === 'number' &&
    Number.isFinite(value.recordCount)
  )
}

function readBackupExportedAt(value: unknown): string {
  return isRecord(value) && typeof value.exportedAt === 'string' ? value.exportedAt : ''
}

/** 把当前内存状态打包成待写入 IndexedDB 的记录（纯函数，便于单测）。 */
export function createPersistedStateRecord(
  data: ImportableMockData,
  snapshot: MockSnapshot | null,
  savedAt: Date = new Date(),
): PersistedStateRecord {
  return {
    id: PERSIST_STATE_RECORD_ID,
    schemaVersion: PERSIST_STATE_SCHEMA_VERSION,
    savedAt: savedAt.toISOString(),
    backup: serializeMockBackup(data, savedAt),
    snapshot: snapshot ? { ...snapshot } : null,
  }
}

/**
 * 每条迁移只负责把记录从 version 升到 version + 1，保持纯函数。
 * 版本 0 是「还没有 schemaVersion 字段」的早期记录（只有 backup/snapshot）；
 * 版本 1 → 2 是 8d 数据历史化：补日期、饮食改按日台账、训练历史归档。
 */
const MIGRATIONS: Record<number, (record: UnknownRecord, now: Date) => UnknownRecord> = {
  0: (record) => ({
    ...record,
    schemaVersion: 1,
    savedAt:
      typeof record.savedAt === 'string' ? record.savedAt : readBackupExportedAt(record.backup),
  }),
  1: (record, now) => {
    // 归档日期取「上次保存那一天」，比迁移当天更接近真实完成时间。
    const savedAtMs = typeof record.savedAt === 'string' ? Date.parse(record.savedAt) : Number.NaN
    const archiveNow = Number.isNaN(savedAtMs) ? now : new Date(savedAtMs)
    const backup = isRecord(record.backup) ? record.backup : null
    return {
      ...record,
      schemaVersion: 2,
      backup: backup
        ? {
            ...backup,
            version: PERSIST_BACKUP_VERSION,
            data: upgradeMockBackupData(backup.data, archiveNow, {
              archiveCompletedSession: true,
            }),
          }
        : record.backup,
    }
  },
  2: (record) => {
    const backup = isRecord(record.backup) ? record.backup : null
    const scrubbed = backup
      ? scrubLegacyInitialSeedData(backup.data)
      : { value: undefined, changed: false }
    return {
      ...record,
      schemaVersion: 3,
      backup: backup && scrubbed.changed ? { ...backup, data: scrubbed.value } : record.backup,
      snapshot: scrubbed.changed ? null : record.snapshot,
    }
  },
}

function detectSchemaVersion(record: UnknownRecord): number | null {
  if (typeof record.schemaVersion === 'number') {
    return Number.isInteger(record.schemaVersion) && record.schemaVersion >= 0
      ? record.schemaVersion
      : null
  }
  // 没有版本号但带 backup 的记录视为最早的 0 版，交给 MIGRATIONS[0] 补字段。
  return isRecord(record.backup) ? 0 : null
}

/** 读取记录声明的结构版本；用于区分「数据损坏」和「数据来自更新的 App 版本」。 */
export function readPersistedSchemaVersion(raw: unknown): number | null {
  return isRecord(raw) ? detectSchemaVersion(raw) : null
}

/**
 * 把任意读到的对象迁移到当前版本。
 * 未来版本（大于当前）返回 null：宁可这一轮不读，也不要用旧代码覆盖新版数据。
 * `now` 只用于给旧数据补日期（缺日期的计划/饮水算作当天），便于单测注入固定时间。
 */
export function migratePersistedStateRecord(
  raw: unknown,
  now: Date = new Date(),
): UnknownRecord | null {
  if (!isRecord(raw)) return null
  const version = detectSchemaVersion(raw)
  if (version === null || version > PERSIST_STATE_SCHEMA_VERSION) return null

  let record = raw
  for (let from = version; from < PERSIST_STATE_SCHEMA_VERSION; from += 1) {
    const step = MIGRATIONS[from]
    if (!step) return null
    record = step(record, now)
  }
  return record
}

/**
 * 把 IndexedDB 读到的原始记录还原成可用的业务数据。
 * 任何校验失败都返回 null（调用方回退到演示数据），不抛错——本地数据永远不该让页面白屏。
 */
export function readPersistedState(raw: unknown, now: Date = new Date()): PersistedState | null {
  const record = migratePersistedStateRecord(raw, now)
  if (!record || record.schemaVersion !== PERSIST_STATE_SCHEMA_VERSION) return null

  try {
    const data = parseMockBackupValue(record.backup, now)
    const scrubbed = scrubLegacyInitialSeedData(data)
    return {
      data: scrubbed.value as ImportableMockData,
      snapshot: !scrubbed.changed && isMockSnapshot(record.snapshot) ? record.snapshot : null,
      savedAt: typeof record.savedAt === 'string' ? record.savedAt : '',
    }
  } catch {
    return null
  }
}
