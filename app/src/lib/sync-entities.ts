import type {
  DietDay,
  FitnessSessionRecord,
  ImportableMockData,
  Meal,
  MockSettings,
  PlanItem,
  ProfileData,
} from '../types'
import { INITIAL_MEALS } from '../data/diet'
import {
  isDietEntryRecord,
  isFitnessSessionRecord,
  isGoalRecord,
  isLongTermPlan,
  isPlanItem,
  isStudyRecord,
  isWaterLogEntry,
} from './mock-data-transfer'
import {
  isEntityKind,
  type EntityCandidate,
  type EntityKind,
  type PullEntity,
} from './sync-contract'

/**
 * 本地数据 ↔ 同步实体的映射，以及 pull 结果的合并（全部是纯函数）。
 *
 * 为什么要有这一层：页面的写路径是「整份 state 换一份新对象」，没有逐条事件；
 * 所以同步层拿「上一轮各实体的内容哈希」做差分，才知道哪些实体真的变了。
 * 这里不碰 IndexedDB，也不发请求，便于单测直接喂数据。
 */

/** 单行实体（档案 / 设置）在本地没有业务 id，统一用这个占位。 */
export const SYNC_SINGLE_ROW_ID = 'self'

/** 一个待同步的实体：`kind` + 业务 id + 完整业务对象（原样进 payload_json）。 */
export interface LocalEntity {
  kind: EntityKind
  id: string
  data: Record<string, unknown>
}

/** 引用 `INITIAL_MEALS` 的餐次顺序，保证 pull 回来后餐次顺序与本地一致。 */
const MEAL_SLOTS = INITIAL_MEALS.map((meal) => ({
  id: meal.id,
  label: meal.label,
  time: meal.time,
}))

export function entityKey(kind: EntityKind, id: string): string {
  return `${kind}:${id}`
}

/**
 * 稳定序列化：对象键排序后再 `JSON.stringify`。
 * 直接 stringify 会受键插入顺序影响，同样的数据会算出不同哈希 → 每轮都误报「变了」。
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`
}

/** FNV-1a 32 位哈希：只用来判断「内容有没有变」，不做安全用途。 */
export function hashText(text: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function hashLocalEntity(entity: LocalEntity): string {
  return hashText(stableStringify(entity.data))
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/**
 * 把本地 11 个切片摊平成同步实体。
 *
 * 不在 v1 同步范围的字段（明确不上传，见 P4 方案 §9.2）：
 * - `reports` / `snapshot` / `eveningReview`（服务端 v1 没有对应表）；
 * - 进行中的 `fitnessSession`（易变的临时态，完成后才归档成 `fitnessHistory`）；
 * - 提醒的开关状态在 `settings.reminders` 里，作为设置的一部分整体同步。
 */
export function collectLocalEntities(data: ImportableMockData): LocalEntity[] {
  const entities: LocalEntity[] = []

  entities.push({
    kind: 'profile',
    id: SYNC_SINGLE_ROW_ID,
    data: { ...data.profile, aiConsent: data.aiConsent } satisfies ProfileData,
  })
  entities.push({ kind: 'settings', id: SYNC_SINGLE_ROW_ID, data: { ...data.settings } })

  for (const goal of data.goals) {
    entities.push({ kind: 'goal', id: goal.id, data: asRecord(goal) ?? {} })
  }
  for (const item of data.planItems) {
    entities.push({ kind: 'plan_item', id: item.id, data: asRecord(item) ?? {} })
  }
  for (const record of data.studyRecords) {
    entities.push({ kind: 'study_record', id: record.id, data: asRecord(record) ?? {} })
  }
  for (const entry of data.waterLog) {
    entities.push({ kind: 'water_log', id: entry.id, data: asRecord(entry) ?? {} })
  }
  for (const record of data.fitnessHistory) {
    entities.push({ kind: 'fitness_session', id: record.id, data: asRecord(record) ?? {} })
  }
  for (const day of data.dietDays) {
    for (const meal of day.meals) {
      for (const entry of meal.entries) {
        entities.push({
          kind: 'diet_entry',
          id: entry.id,
          data: {
            ...entry,
            date: day.date,
            meal: meal.id,
            mealLabel: meal.label,
            mealTime: meal.time,
          },
        })
      }
    }
  }
  for (const plan of data.longTermPlans ?? []) {
    entities.push({ kind: 'long_term_plan', id: plan.id, data: asRecord(plan) ?? {} })
  }

  return entities
}

/** 内容哈希索引：`entityKey → hash`，同步层用它判断「这一轮哪些实体真的变了」。 */
export type EntityHashes = Record<string, string>

export function hashEntities(entities: LocalEntity[]): EntityHashes {
  const hashes: EntityHashes = {}
  for (const entity of entities) hashes[entityKey(entity.kind, entity.id)] = hashLocalEntity(entity)
  return hashes
}

export interface EntityDiff {
  /** 新增或内容变化的实体（`updatedAt` 由调用方盖上当前时间）。 */
  changed: LocalEntity[]
  /** 上一轮存在、这一轮消失的实体键，需要发墓碑。 */
  removed: string[]
  /** 这一轮所有实体的新哈希索引（含未变化的）。 */
  hashes: EntityHashes
}

/**
 * 与上一轮哈希做差分。没有基线（首次开启同步/首次启动）时视作「全部是新增」，
 * 由调用方决定是走 bootstrap 还是直接 enqueue。
 */
export function diffLocalEntities(entities: LocalEntity[], baseline: EntityHashes): EntityDiff {
  const hashes = hashEntities(entities)
  const changed: LocalEntity[] = []
  const present = new Set<string>()
  for (const entity of entities) {
    const key = entityKey(entity.kind, entity.id)
    present.add(key)
    if (baseline[key] !== hashes[key]) changed.push(entity)
  }
  const removed = Object.keys(baseline).filter((key) => !present.has(key))
  return { changed, removed, hashes }
}

function upsertById<T extends { id: string }>(list: T[], item: T): T[] {
  const index = list.findIndex((entry) => entry.id === item.id)
  if (index < 0) return [...list, item]
  const next = list.slice()
  next[index] = item
  return next
}

function removeById<T extends { id: string }>(list: T[], id: string): T[] {
  return list.filter((entry) => entry.id !== id)
}

/**
 * pull 合并的兜底：服务端只保证索引列合法（P4 §7.2），payload 正文原样回传。
 * 每条记录落地前还要过一遍「与备份导入同一套」的形状校验，
 * 形状不对就计入 skipped —— 绝不能把通不过校验的记录写进本地存储，
 * 否则下次启动整份存档会被判为损坏而回退到初始数据。
 */
function matchesRecordShape(kind: EntityKind, payload: Record<string, unknown>): boolean {
  switch (kind) {
    case 'goal':
      return isGoalRecord(payload)
    case 'plan_item':
      return isPlanItem(payload)
    case 'study_record':
      return isStudyRecord(payload)
    case 'water_log':
      return isWaterLogEntry(payload)
    case 'fitness_session':
      return isFitnessSessionRecord(payload)
    case 'diet_entry':
      return isDietEntryRecord(payload)
    case 'long_term_plan':
      return isLongTermPlan(payload)
    default:
      return true
  }
}

/** 用一条 `diet_entry` 更新按日台账；该日四餐固定存在，顺序稳定。 */
function upsertDietEntry(dietDays: DietDay[], data: Record<string, unknown>): DietDay[] {
  const date = data.date as string
  const mealId = data.meal as string
  const mealsForDate = dietDays.find((day) => day.date === date)?.meals ?? null
  const baseMeals: Meal[] =
    mealsForDate && mealsForDate.length > 0
      ? mealsForDate.map((meal) => ({ ...meal, entries: [...meal.entries] }))
      : MEAL_SLOTS.map((slot) => ({ ...slot, entries: [] }))

  const target = baseMeals.find((meal) => meal.id === mealId)
  const entry = data as unknown as Meal['entries'][number]
  if (target) {
    target.entries = upsertById(target.entries, entry)
  } else {
    baseMeals.push({
      id: mealId as Meal['id'],
      label: typeof data.mealLabel === 'string' ? data.mealLabel : mealId,
      time: typeof data.mealTime === 'string' ? data.mealTime : '',
      entries: [entry],
    })
  }

  const day: DietDay = { date, meals: baseMeals }
  const others = dietDays.filter((dayItem) => dayItem.date !== date)
  const hasAnyEntry = day.meals.some((meal) => meal.entries.length > 0)
  return hasAnyEntry ? [...others, day] : others
}

function removeDietEntry(dietDays: DietDay[], entryId: string): DietDay[] {
  return dietDays
    .map((day) => ({
      date: day.date,
      meals: day.meals.map((meal) => ({
        ...meal,
        entries: meal.entries.filter((entry) => entry.id !== entryId),
      })),
    }))
    .filter((day) => day.meals.some((meal) => meal.entries.length > 0))
}

export interface ApplyPulledResult {
  data: ImportableMockData
  /** 实际写入本地的条数。 */
  applied: number
  /** 因本地更新更晚而跳过的条数（LWW，服务端在这类冲突里不算权威）。 */
  skipped: number
  /** 合并后的实体时间索引（`entityKey → updatedAt`）。 */
  times: Record<string, number>
  /** 合并后的内容哈希索引，直接作为下一轮差分的基线。 */
  hashes: EntityHashes
}

/**
 * 把 pull 回来的实体合并进本地数据（LWW：`updatedAt` 不早于本地才覆盖）。
 *
 * 时间索引由调用方持久化；缺省（新实体）视为 0，因此服务端的任何写入都会落地。
 * 墓碑直接删除本地实体；单行实体的「删除」忽略。
 */
export function applyPulledEntities(
  data: ImportableMockData,
  entities: PullEntity[],
  times: Record<string, number>,
  nowMs: number,
): ApplyPulledResult {
  let next: ImportableMockData = { ...data }
  const nextTimes: Record<string, number> = { ...times }
  let applied = 0
  let skipped = 0

  for (const entity of entities) {
    if (!isEntityKind(entity.kind)) {
      skipped += 1
      continue
    }
    // 单行实体在服务端没有业务 id（返回 null），本地统一落到占位 id 上。
    const id =
      entity.id ??
      (entity.kind === 'profile' || entity.kind === 'settings' ? SYNC_SINGLE_ROW_ID : null)
    if (!id) {
      skipped += 1
      continue
    }
    const key = entityKey(entity.kind, id)
    const localUpdatedAt = nextTimes[key] ?? 0
    if (entity.updatedAt < localUpdatedAt) {
      skipped += 1
      continue
    }

    const payload = asRecord(entity.data)
    if (!entity.deleted && !payload) {
      skipped += 1
      continue
    }
    if (!entity.deleted && payload) {
      // 形状不对、或正文 id 与信封 id 不一致：跳过而不是把坏记录写进本地存储。
      const singleRow = entity.kind === 'profile' || entity.kind === 'settings'
      if (!matchesRecordShape(entity.kind, payload)) {
        skipped += 1
        continue
      }
      if (!singleRow && payload.id !== id) {
        skipped += 1
        continue
      }
    }

    switch (entity.kind) {
      case 'profile': {
        if (!payload) break
        next = {
          ...next,
          profile: { ...next.profile, ...(payload as Partial<ProfileData>) },
          aiConsent: typeof payload.aiConsent === 'boolean' ? payload.aiConsent : next.aiConsent,
        }
        applied += 1
        break
      }
      case 'settings': {
        if (!payload) break
        next = { ...next, settings: { ...next.settings, ...(payload as Partial<MockSettings>) } }
        applied += 1
        break
      }
      case 'goal': {
        if (entity.deleted) {
          next = { ...next, goals: removeById(next.goals, id) }
        } else if (payload) {
          next = { ...next, goals: upsertById(next.goals, payload as never) }
        }
        applied += 1
        break
      }
      case 'plan_item': {
        if (entity.deleted) {
          next = { ...next, planItems: removeById(next.planItems, id) }
        } else if (payload && isPlanItem(payload)) {
          next = { ...next, planItems: upsertById(next.planItems, payload as unknown as PlanItem) }
        } else {
          skipped += 1
          continue
        }
        applied += 1
        break
      }
      case 'study_record': {
        if (entity.deleted) {
          next = { ...next, studyRecords: removeById(next.studyRecords, id) }
        } else if (payload) {
          next = { ...next, studyRecords: upsertById(next.studyRecords, payload as never) }
        } else {
          skipped += 1
          continue
        }
        applied += 1
        break
      }
      case 'water_log': {
        if (entity.deleted) {
          next = { ...next, waterLog: removeById(next.waterLog, id) }
        } else if (payload) {
          next = { ...next, waterLog: upsertById(next.waterLog, payload as never) }
        } else {
          skipped += 1
          continue
        }
        applied += 1
        break
      }
      case 'fitness_session': {
        if (entity.deleted) {
          next = { ...next, fitnessHistory: removeById(next.fitnessHistory, id) }
        } else if (payload) {
          const record = payload as unknown as FitnessSessionRecord
          next = {
            ...next,
            fitnessHistory: [...removeById(next.fitnessHistory, record.id), record].sort(
              (left, right) => right.completedAt.localeCompare(left.completedAt),
            ),
          }
        } else {
          skipped += 1
          continue
        }
        applied += 1
        break
      }
      case 'diet_entry': {
        if (entity.deleted) {
          next = { ...next, dietDays: removeDietEntry(next.dietDays, id) }
        } else if (payload && isDietEntryRecord(payload)) {
          next = { ...next, dietDays: upsertDietEntry(next.dietDays, payload) }
        } else {
          skipped += 1
          continue
        }
        applied += 1
        break
      }
      case 'long_term_plan': {
        const plans = next.longTermPlans ?? []
        if (entity.deleted) {
          next = { ...next, longTermPlans: removeById(plans, id) }
        } else if (payload) {
          next = { ...next, longTermPlans: upsertById(plans, payload as never) }
        } else {
          skipped += 1
          continue
        }
        applied += 1
        break
      }
      default: {
        skipped += 1
        continue
      }
    }

    nextTimes[key] = Math.max(localUpdatedAt, entity.updatedAt)
  }

  // 空转（全部被跳过）时不必重算哈希，省一次序列化。
  const hashes =
    applied > 0
      ? hashEntities(collectLocalEntities(next))
      : hashEntities(collectLocalEntities(data))
  void nowMs
  return { data: next, applied, skipped, times: nextTimes, hashes }
}

/** 把「这一轮变化」转成 push 用的候选实体，`updatedAt` 由调用方盖当前时间。 */
export function toCandidates(entities: LocalEntity[], updatedAt: number): EntityCandidate[] {
  return entities.map((entity) => ({
    kind: entity.kind,
    id: entity.id,
    updatedAt,
    deleted: false,
    data: entity.data,
  }))
}

/** 把「上一轮存在、这一轮消失」的实体键转成墓碑候选。 */
export function removedCandidates(keys: string[], updatedAt: number): EntityCandidate[] {
  return keys.flatMap((key) => {
    const separator = key.indexOf(':')
    if (separator <= 0) return []
    const kind = key.slice(0, separator) as EntityKind
    return [{ kind, id: key.slice(separator + 1), updatedAt, deleted: true }]
  })
}
