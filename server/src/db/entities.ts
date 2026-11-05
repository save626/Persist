import type { DbParam } from './driver.js'

/**
 * 同步实体的唯一描述：前端推上来的每一种记录，在这里定义落库时怎么拆列。
 *
 * 拆列的理由：同步正文整份进 payload_json（向前兼容，前端加字段不用迁移），
 * 但高频查询字段（日期、科目、热量…）单独成列，步骤 13 的服务端聚合只读列，
 * 不用把整包 JSON 解出来。
 *
 * 数据校验都收在这里（normalizeEntity）：路由层只负责通知/鉴权，落库前必须过这一关，
 * 免得脏数据靠 SQLite 的 NOT NULL 报一句看不懂的话。
 */

export const ENTITY_KINDS = [
  'profile',
  'settings',
  'plan_item',
  'study_record',
  'fitness_session',
  'diet_entry',
  'water_log',
  'goal',
  'long_term_plan',
] as const

export type EntityKind = (typeof ENTITY_KINDS)[number]

const ENTITY_KIND_SET = new Set<string>(ENTITY_KINDS)

export function isEntityKind(value: unknown): value is EntityKind {
  return typeof value === 'string' && ENTITY_KIND_SET.has(value)
}

export const SINGLE_ROW_KINDS: ReadonlySet<EntityKind> = new Set<EntityKind>([
  'profile',
  'settings',
])

export type EntityPayload = Record<string, unknown>

export class EntityDataError extends Error {
  readonly code = 'invalid_entity'

  constructor(message: string) {
    super(message)
    this.name = 'EntityDataError'
  }
}

export interface EntityCandidate {
  kind: EntityKind
  id?: string | null
  updatedAt: number
  deleted?: boolean
  data?: unknown
}

export interface NormalizedEntity {
  kind: EntityKind
  table: string
  singleRow: boolean
  /** 单行实体（profile / settings）为 null。 */
  entityId: string | null
  updatedAt: number
  deleted: boolean
  payloadJson: string
  /** 拆出来的列；墓碑不写列，只落 deleted_at + rev。 */
  columns: Record<string, DbParam>
}

interface ColumnSpec {
  name: string
  read: (data: EntityPayload) => DbParam
}

export interface EntityDefinition {
  table: string
  singleRow: boolean
  columns: ColumnSpec[]
}

const MAX_ID_LENGTH = 64
const MAX_TEXT_LENGTH = 200

function readValue(data: EntityPayload, field: string): unknown {
  return data[field]
}

function readString(
  data: EntityPayload,
  field: string,
  options: { required?: boolean; maxLength?: number } = {},
): string | null {
  const raw = readValue(data, field)
  if (raw === undefined || raw === null || raw === '') {
    if (options.required) throw new EntityDataError(`${field} 是必填项且不能为空。`)
    return null
  }
  if (typeof raw !== 'string') throw new EntityDataError(`${field} 必须是字符串。`)
  if (raw.length > (options.maxLength ?? MAX_TEXT_LENGTH)) {
    throw new EntityDataError(
      `${field} 超长（上限 ${options.maxLength ?? MAX_TEXT_LENGTH} 字符）。`,
    )
  }
  return raw
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function readDate(
  data: EntityPayload,
  field: string,
  options: { required?: boolean } = {},
): string | null {
  const raw = readString(data, field, { required: options.required, maxLength: 10 })
  if (raw === null) return null
  const [year, month, day] = raw.split('-').map(Number) as [number, number, number]
  const stamp = Date.UTC(year, month - 1, day)
  const check = new Date(stamp)
  if (
    !DATE_PATTERN.test(raw) ||
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    throw new EntityDataError(`${field} 必须是 YYYY-MM-DD 的合法日期。`)
  }
  return raw
}

function readNumber(
  data: EntityPayload,
  field: string,
  options: { required?: boolean; min?: number; max?: number; fallback?: number } = {},
): number | null {
  const raw = readValue(data, field)
  if (raw === undefined || raw === null) {
    if (options.required) throw new EntityDataError(`${field} 是必填项。`)
    return options.fallback ?? null
  }
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    throw new EntityDataError(`${field} 必须是有限数字。`)
  }
  if (options.min !== undefined && raw < options.min) {
    throw new EntityDataError(`${field} 不能小于 ${options.min}。`)
  }
  if (options.max !== undefined && raw > options.max) {
    throw new EntityDataError(`${field} 不能大于 ${options.max}。`)
  }
  return raw
}

function readBoolean(data: EntityPayload, field: string, fallback: boolean): 0 | 1 {
  const raw = readValue(data, field)
  if (raw === undefined || raw === null) return fallback ? 1 : 0
  if (typeof raw !== 'boolean') throw new EntityDataError(`${field} 必须是布尔值。`)
  return raw ? 1 : 0
}

function readEnum<T extends string>(
  data: EntityPayload,
  field: string,
  allowed: readonly T[],
  options: { required?: boolean; fallback?: T } = {},
): string | null {
  const raw = readValue(data, field)
  if (raw === undefined || raw === null || raw === '') {
    if (options.required)
      throw new EntityDataError(`${field} 是必填项，可选值：${allowed.join(' / ')}。`)
    return options.fallback ?? null
  }
  if (typeof raw !== 'string' || !allowed.includes(raw as T)) {
    throw new EntityDataError(`${field} 必须是 ${allowed.join(' / ')} 之一。`)
  }
  return raw
}

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/

function readTime(data: EntityPayload, field: string): string {
  const raw = readString(data, field, { required: true, maxLength: 5 })
  if (raw === null || !TIME_PATTERN.test(raw)) {
    throw new EntityDataError(`${field} 必须是 HH:MM 格式的时间。`)
  }
  return raw
}

const MEALS = ['breakfast', 'lunch', 'dinner', 'snack'] as const
const STUDY_CATEGORIES = ['english', 'math'] as const
const SESSION_STATUSES = ['active', 'completed'] as const
const PLAN_KINDS = ['default', 'food', 'water', 'study'] as const
const PLAN_STATUSES = ['draft', 'active', 'archived'] as const

export interface FitnessTotals {
  totalSets: number
  doneSets: number
  volumeKg: number
  durationMinutes: number
  distanceKm: number
}

/**
 * 训练容量统计：服务端只认 `exercises[].sets[]` 里的 done 集合，
 * 口径与前端 FitnessPage 一致（重量 × 次数为容量；时长、距离各算各的）。
 */
export function deriveFitnessTotals(exercises: unknown): FitnessTotals {
  const totals: FitnessTotals = {
    totalSets: 0,
    doneSets: 0,
    volumeKg: 0,
    durationMinutes: 0,
    distanceKm: 0,
  }
  if (!Array.isArray(exercises)) return totals
  for (const exercise of exercises) {
    if (typeof exercise !== 'object' || exercise === null) continue
    const sets = (exercise as { sets?: unknown }).sets
    if (!Array.isArray(sets)) continue
    for (const set of sets) {
      if (typeof set !== 'object' || set === null) continue
      const entry = set as {
        done?: unknown
        weight?: unknown
        reps?: unknown
        durationMinutes?: unknown
        distanceKm?: unknown
      }
      totals.totalSets += 1
      if (entry.done !== true) continue
      totals.doneSets += 1
      if (typeof entry.weight === 'number' && typeof entry.reps === 'number') {
        if (Number.isFinite(entry.weight) && Number.isFinite(entry.reps)) {
          totals.volumeKg += entry.weight * entry.reps
        }
      }
      if (typeof entry.durationMinutes === 'number' && Number.isFinite(entry.durationMinutes)) {
        totals.durationMinutes += entry.durationMinutes
      }
      if (typeof entry.distanceKm === 'number' && Number.isFinite(entry.distanceKm)) {
        totals.distanceKm += entry.distanceKm
      }
    }
  }
  totals.volumeKg = Math.round(totals.volumeKg * 100) / 100
  totals.durationMinutes = Math.round(totals.durationMinutes * 100) / 100
  totals.distanceKm = Math.round(totals.distanceKm * 100) / 100
  return totals
}

/** 同一份 data 的容量统计只算一次（5 个列各读一遍太浪费）。 */
const FITNESS_TOTALS_CACHE = new WeakMap<EntityPayload, FitnessTotals>()

function fitnessTotals(data: EntityPayload): FitnessTotals {
  const cached = FITNESS_TOTALS_CACHE.get(data)
  if (cached) return cached
  const totals = deriveFitnessTotals(data.exercises)
  FITNESS_TOTALS_CACHE.set(data, totals)
  return totals
}

function fitnessColumn(name: keyof FitnessTotals, data: EntityPayload): DbParam {
  return fitnessTotals(data)[name]
}

const ENTITY_DEFINITIONS: Record<EntityKind, EntityDefinition> = {
  profile: { table: 'profiles', singleRow: true, columns: [] },
  settings: {
    table: 'settings',
    singleRow: true,
    columns: [{ name: 'summary_only', read: (data) => readBoolean(data, 'summaryOnly', false) }],
  },
  plan_item: {
    table: 'plan_items',
    singleRow: false,
    columns: [
      { name: 'date', read: (data) => readDate(data, 'date', { required: true }) },
      { name: 'kind', read: (data) => readEnum(data, 'kind', PLAN_KINDS, { fallback: 'default' }) },
      { name: 'done', read: (data) => readBoolean(data, 'done', false) },
    ],
  },
  study_record: {
    table: 'study_records',
    singleRow: false,
    columns: [
      { name: 'date', read: (data) => readDate(data, 'date', { required: true }) },
      {
        name: 'category',
        read: (data) => readEnum(data, 'category', STUDY_CATEGORIES, { required: true }),
      },
      {
        name: 'duration_min',
        read: (data) => readNumber(data, 'duration', { min: 0, max: 24 * 60, fallback: 0 }),
      },
    ],
  },
  fitness_session: {
    table: 'fitness_sessions',
    singleRow: false,
    columns: [
      { name: 'date', read: (data) => readDate(data, 'date', { required: true }) },
      {
        name: 'status',
        read: (data) => readEnum(data, 'status', SESSION_STATUSES, { fallback: 'completed' }),
      },
      {
        name: 'completed_at',
        read: (data) => readString(data, 'completedAt', { maxLength: 40 }),
      },
      { name: 'total_sets', read: (data) => fitnessColumn('totalSets', data) },
      { name: 'done_sets', read: (data) => fitnessColumn('doneSets', data) },
      { name: 'volume_kg', read: (data) => fitnessColumn('volumeKg', data) },
      { name: 'duration_min', read: (data) => fitnessColumn('durationMinutes', data) },
      { name: 'distance_km', read: (data) => fitnessColumn('distanceKm', data) },
    ],
  },
  diet_entry: {
    table: 'diet_entries',
    singleRow: false,
    columns: [
      { name: 'date', read: (data) => readDate(data, 'date', { required: true }) },
      { name: 'meal', read: (data) => readEnum(data, 'meal', MEALS, { required: true }) },
      { name: 'name', read: (data) => readString(data, 'name') },
      { name: 'calories', read: (data) => readNumber(data, 'calories', { min: 0, fallback: 0 }) },
      { name: 'protein', read: (data) => readNumber(data, 'protein', { min: 0, fallback: 0 }) },
      { name: 'carbs', read: (data) => readNumber(data, 'carbs', { min: 0, fallback: 0 }) },
      { name: 'fat', read: (data) => readNumber(data, 'fat', { min: 0, fallback: 0 }) },
    ],
  },
  water_log: {
    table: 'water_logs',
    singleRow: false,
    columns: [
      { name: 'date', read: (data) => readDate(data, 'date', { required: true }) },
      { name: 'time', read: (data) => readTime(data, 'time') },
      {
        name: 'milliliters',
        read: (data) => readNumber(data, 'milliliters', { required: true, min: 0, max: 10_000 }),
      },
    ],
  },
  goal: {
    table: 'goals',
    singleRow: false,
    columns: [
      { name: 'date', read: (data) => readDate(data, 'date', { required: true }) },
      { name: 'title', read: (data) => readString(data, 'title', { required: true }) },
      { name: 'enabled', read: (data) => readBoolean(data, 'enabled', true) },
    ],
  },
  long_term_plan: {
    table: 'long_term_plans',
    singleRow: false,
    columns: [
      {
        name: 'status',
        read: (data) => readEnum(data, 'status', PLAN_STATUSES, { fallback: 'draft' }),
      },
    ],
  },
}

export function entityDefinition(kind: EntityKind): EntityDefinition {
  return ENTITY_DEFINITIONS[kind]
}

function asPayload(data: unknown): EntityPayload {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new EntityDataError('data 必须是对象。')
  }
  return data as EntityPayload
}

/**
 * 校验并拆好一条待落库的实体。
 * `updatedAt` 是客户端的逻辑时间（毫秒），LWW 比较和 pull 游标都靠它。
 */
export function normalizeEntity(candidate: EntityCandidate): NormalizedEntity {
  if (!isEntityKind(candidate.kind)) {
    throw new EntityDataError(`不认识的实体类型：${String(candidate.kind)}。`)
  }
  const definition = ENTITY_DEFINITIONS[candidate.kind]
  if (!Number.isFinite(candidate.updatedAt) || candidate.updatedAt <= 0) {
    throw new EntityDataError('updatedAt 必须是正的毫秒时间戳。')
  }

  const deleted = candidate.deleted === true
  const data = deleted ? null : asPayload(candidate.data)

  let entityId: string | null = null
  if (!definition.singleRow) {
    // id 允许放在外层，也允许跟着 payload 的 id 走（前端状态切片本来就把 id 放在记录里）。
    const rawId = candidate.id ?? (data ? data.id : undefined)
    if (typeof rawId !== 'string' || rawId.trim().length === 0 || rawId.length > MAX_ID_LENGTH) {
      throw new EntityDataError('实体缺少合法 id（1–64 字符）。')
    }
    entityId = rawId
  }

  if (deleted) {
    return {
      kind: candidate.kind,
      table: definition.table,
      singleRow: definition.singleRow,
      entityId,
      updatedAt: Math.trunc(candidate.updatedAt),
      deleted: true,
      payloadJson: '{}',
      columns: {},
    }
  }

  const columns: Record<string, DbParam> = {}
  for (const column of definition.columns) columns[column.name] = column.read(data as EntityPayload)

  return {
    kind: candidate.kind,
    table: definition.table,
    singleRow: definition.singleRow,
    entityId,
    updatedAt: Math.trunc(candidate.updatedAt),
    deleted: false,
    payloadJson: JSON.stringify(data),
    columns,
  }
}
