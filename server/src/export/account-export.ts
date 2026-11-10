import type { Db } from '../db/driver.js'
import {
  PERSIST_EXPORT_MODE,
  PERSIST_EXPORT_SCHEMA_VERSION,
  PERSIST_EXPORT_VERSION,
  type PersistExportData,
  type PersistExportEnvelope,
  type PersistExportRecord,
} from '@persist/shared/contract/export'

/**
 * 把当前账号的同步实体重组为客户端 0.3.0 备份形状（步骤 14c）。
 *
 * 只读 `deleted_at IS NULL` 的业务行；不读 devices / users / sync_ops / analysis_reports。
 * 服务端 v1 不接收本地报告、复盘和 outbox，因此这三处分别输出空数组 / null，
 * 不把服务端分析归档伪装成本地 ReportRecord。
 */

interface PayloadRow {
  id: string
  payload_json: string
}

interface SinglePayloadRow {
  payload_json: string
}

const INTERNAL_FIELDS = new Set([
  'rev',
  'updatedAt',
  'deletedAt',
  'deleted_at',
  'userId',
  'user_id',
  'deviceId',
  'device_id',
  'token',
  'tokenHash',
  'token_hash',
  'recoveryCode',
  'recoveryHash',
  'recovery_hash',
  'opId',
  'outbox',
  'authorization',
  'passwordHash',
])

const MEAL_SLOTS = [
  { id: 'breakfast', label: '早餐', time: '08:35' },
  { id: 'lunch', label: '午餐', time: '12:25' },
  { id: 'dinner', label: '晚餐', time: '18:30' },
  { id: 'snack', label: '加餐', time: '15:40' },
] as const

function isRecord(value: unknown): value is PersistExportRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sanitizeRecord(value: unknown, label: string): PersistExportRecord {
  if (!isRecord(value)) throw new Error(`${label}的 payload 不是 JSON 对象。`)
  const cleaned: PersistExportRecord = {}
  for (const [key, field] of Object.entries(value)) {
    if (!INTERNAL_FIELDS.has(key)) cleaned[key] = field
  }
  return cleaned
}

function readPayload(payloadJson: string, label: string): PersistExportRecord {
  try {
    return sanitizeRecord(JSON.parse(payloadJson) as unknown, label)
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`${label}的 payload_json 无法解析。`)
    throw error
  }
}

function loadSingle(
  db: Db,
  userId: string,
  table: 'profiles' | 'settings',
): PersistExportRecord | null {
  const row = db
    .prepare<SinglePayloadRow>(
      `SELECT payload_json FROM ${table} WHERE user_id = ? AND deleted_at IS NULL LIMIT 1`,
    )
    .get(userId)
  return row ? readPayload(row.payload_json, table) : null
}

function loadList(db: Db, userId: string, table: string): PersistExportRecord[] {
  return db
    .prepare<PayloadRow>(
      `SELECT id, payload_json FROM ${table}
       WHERE user_id = ? AND deleted_at IS NULL ORDER BY id ASC`,
    )
    .all(userId)
    .map((row) => ({ ...readPayload(row.payload_json, table), id: row.id }))
}

function textField(record: PersistExportRecord, field: string): string {
  const value = record[field]
  return typeof value === 'string' ? value : ''
}

function sortRecords(records: PersistExportRecord[], fields: string[]): PersistExportRecord[] {
  return records.slice().sort((left, right) => {
    for (const field of fields) {
      const comparison = textField(left, field).localeCompare(textField(right, field))
      if (comparison !== 0) return comparison
    }
    return textField(left, 'id').localeCompare(textField(right, 'id'))
  })
}

function emptyProfile(): PersistExportRecord {
  return {
    age: 0,
    height: 0,
    weight: 0,
    targetWeight: 0,
    goal: '',
    experience: '',
    frequency: '',
    equipment: '',
    dietPreference: '',
    allergies: '',
    bedtime: '',
    sleepHours: 0,
    stress: '',
    aiConsent: false,
  }
}

function emptySettings(): PersistExportRecord {
  return {
    reminders: [],
    summaryOnly: false,
    sources: { fitness: false, diet: false, study: false, profile: false },
    dailyBrief: { enabled: false, at: '21:00' },
  }
}

function requiredText(record: PersistExportRecord, field: string): string {
  const value = record[field]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`饮食记录缺少 ${field}，无法组装 0.3.0 导出。`)
  }
  return value
}

function dayMeals(
  days: Map<string, Map<string, { label: string; time: string; entries: PersistExportRecord[] }>>,
  date: string,
) {
  const existing = days.get(date)
  if (existing) return existing
  const created = new Map<string, { label: string; time: string; entries: PersistExportRecord[] }>()
  days.set(date, created)
  return created
}

function buildDietDays(rows: PersistExportRecord[]): PersistExportRecord[] {
  const days = new Map<
    string,
    Map<string, { label: string; time: string; entries: PersistExportRecord[] }>
  >()

  for (const record of rows) {
    const date = requiredText(record, 'date')
    const meal = requiredText(record, 'meal')
    const slot = MEAL_SLOTS.find((item) => item.id === meal)
    if (!slot) throw new Error(`饮食记录包含未知餐次 ${meal}。`)

    const meals = dayMeals(days, date)
    const target = meals.get(meal) ?? {
      label: textField(record, 'mealLabel') || slot.label,
      time: textField(record, 'mealTime') || slot.time,
      entries: [],
    }
    const entry = { ...record }
    delete entry.date
    delete entry.meal
    delete entry.mealLabel
    delete entry.mealTime
    target.entries.push(entry)
    meals.set(meal, target)
  }

  return [...days.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, meals]) => ({
      date,
      meals: MEAL_SLOTS.map((slot) => {
        const saved = meals.get(slot.id)
        return {
          id: slot.id,
          label: saved?.label ?? slot.label,
          time: saved?.time ?? slot.time,
          entries: saved ? sortRecords(saved.entries, ['id']) : [],
        }
      }),
    }))
}

export function buildAccountExport(
  db: Db,
  userId: string,
  exportedAt: string,
): PersistExportEnvelope {
  const profile = loadSingle(db, userId, 'profiles') ?? emptyProfile()
  const settings = loadSingle(db, userId, 'settings') ?? emptySettings()
  const goals = sortRecords(loadList(db, userId, 'goals'), ['date', 'title'])
  const planItems = sortRecords(loadList(db, userId, 'plan_items'), ['date', 'time', 'name'])
  const studyRecords = sortRecords(loadList(db, userId, 'study_records'), ['date', 'startTime'])
  const fitnessHistory = sortRecords(loadList(db, userId, 'fitness_sessions'), [
    'date',
    'completedAt',
  ])
  const waterLog = sortRecords(loadList(db, userId, 'water_logs'), ['date', 'time'])
  const dietDays = buildDietDays(loadList(db, userId, 'diet_entries'))
  const longTermPlans = sortRecords(loadList(db, userId, 'long_term_plans'), ['createdAt', 'title'])

  const data: PersistExportData = {
    goals,
    planItems,
    waterLog,
    studyRecords,
    dietDays,
    fitnessSession: null,
    fitnessHistory,
    profile,
    settings,
    aiConsent: profile.aiConsent === true,
    eveningReview: null,
    reports: [],
    longTermPlans,
  }

  return {
    app: 'Persist',
    version: PERSIST_EXPORT_VERSION,
    mode: PERSIST_EXPORT_MODE,
    schemaVersion: PERSIST_EXPORT_SCHEMA_VERSION,
    exportedAt,
    data,
  }
}
