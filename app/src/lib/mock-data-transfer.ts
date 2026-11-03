import { countProfileFields } from '../data/profile'
import { isExerciseKind } from './fitness'
import { isValidIsoDate, MAX_PER_WEEK, PLAN_MODULES, WEEKLY_TARGET_UNITS } from './long-term-plan'
import type {
  Exercise,
  FitnessSessionState,
  ImportableMockData,
  LongTermPlan,
  LongTermPlanStatus,
  Meal,
  PlanCadence,
  PlanItem,
  ProfileData,
  ReportRecord,
  StudyCategory,
  StudyRecord,
  WorkoutSet,
} from '../types'

type UnknownRecord = Record<string, unknown>
function isNonNegativeNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isPositiveNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function isRpe(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= 10
}

function isWorkoutSet(value: unknown): value is WorkoutSet {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    !value.id.trim() ||
    typeof value.done !== 'boolean'
  ) {
    return false
  }
  if (value.weight !== undefined && !isNonNegativeNumber(value.weight)) return false
  if (value.reps !== undefined && !isPositiveNumber(value.reps)) return false
  if (value.durationMinutes !== undefined && !isPositiveNumber(value.durationMinutes)) return false
  if (value.distanceKm !== undefined && !isPositiveNumber(value.distanceKm)) return false
  if (value.rpe !== undefined && !isRpe(value.rpe)) return false
  return (
    isPositiveNumber(value.reps) ||
    isPositiveNumber(value.durationMinutes) ||
    isPositiveNumber(value.distanceKm)
  )
}

function isExercise(value: unknown): value is Exercise {
  if (!isRecord(value)) return false
  if (
    typeof value.id !== 'string' ||
    !value.id.trim() ||
    typeof value.name !== 'string' ||
    !value.name.trim() ||
    typeof value.muscle !== 'string' ||
    typeof value.equipment !== 'string' ||
    typeof value.targetReps !== 'string' ||
    typeof value.rest !== 'string'
  ) {
    return false
  }
  if (value.kind !== undefined && !isExerciseKind(value.kind)) return false
  if (!Array.isArray(value.sets) || !value.sets.every(isWorkoutSet)) return false

  if (value.kind === 'strength') {
    return value.sets.every((set) => isPositiveNumber(set.reps))
  }
  if (value.kind === 'duration') {
    return value.sets.every((set) => isPositiveNumber(set.durationMinutes))
  }
  if (value.kind === 'distance') {
    return value.sets.every((set) => isPositiveNumber(set.distanceKm))
  }
  return true
}

function isFitnessSession(value: unknown): value is FitnessSessionState {
  return (
    isRecord(value) &&
    typeof value.activeTemplateId === 'string' &&
    Boolean(value.activeTemplateId.trim()) &&
    (value.sessionStatus === 'active' || value.sessionStatus === 'completed') &&
    isNonNegativeNumber(value.elapsedSeconds) &&
    Array.isArray(value.exercises) &&
    value.exercises.every(isExercise)
  )
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function hasStrings(value: unknown, keys: string[]): value is UnknownRecord {
  return isRecord(value) && keys.every((key) => isString(value[key]))
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString)
}

function isPlanItem(value: unknown): value is PlanItem {
  return (
    hasStrings(value, ['id', 'name', 'time', 'detail', 'kind']) && typeof value.done === 'boolean'
  )
}

function isStudyRecord(value: unknown): value is StudyRecord {
  return (
    hasStrings(value, ['id', 'category', 'source', 'date', 'startTime', 'note']) &&
    (value.category === 'english' || value.category === 'math') &&
    typeof value.duration === 'number' &&
    Number.isFinite(value.duration)
  )
}

function isMeal(value: unknown): value is Meal {
  return (
    hasStrings(value, ['id', 'label', 'time']) &&
    Array.isArray(value.entries) &&
    value.entries.every(
      (entry) =>
        hasStrings(entry, ['id', 'name', 'portion']) &&
        ['calories', 'protein', 'carbs', 'fat'].every(
          (key) => typeof (entry as UnknownRecord)[key] === 'number',
        ),
    )
  )
}

function isReport(value: unknown): value is ReportRecord {
  return (
    hasStrings(value, ['id', 'type', 'title', 'date', 'period', 'summary', 'status']) &&
    Array.isArray(value.metric) &&
    value.metric.every((metric) => hasStrings(metric, ['label', 'value', 'detail'])) &&
    isStringArray(value.conclusions) &&
    isStringArray(value.actions) &&
    isStringArray(value.evidence)
  )
}

function requireArray<T>(value: unknown, label: string, guard: (item: unknown) => item is T): T[] {
  if (!Array.isArray(value) || !value.every(guard)) {
    throw new Error(`${label}格式不完整`)
  }
  return value
}

const PLAN_CADENCES: PlanCadence[] = ['weekly', 'cycle']
const PLAN_STATUSES: LongTermPlanStatus[] = ['draft', 'active', 'archived']
const PLAN_SOURCES: Array<LongTermPlan['source']> = ['ai-chat', 'manual']

function includesValue<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (values as readonly string[]).includes(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function joinField(base: string, key: string) {
  return base ? `${base}.${key}` : key
}

/** 把 unknown 收窄成「严格 YYYY-MM-DD」，日期语义复用 lib/long-term-plan.ts 的 isValidIsoDate。 */
function isValidIsoDateValue(value: unknown): value is string {
  return typeof value === 'string' && isValidIsoDate(value)
}

/**
 * createdAt 由 createLongTermPlan 写成 now.toISOString()，是带时分秒的 ISO 时间串，
 * 不能按 YYYY-MM-DD 校验；这里同时接受纯日期，兼容手工写入的历史数据。
 * 其他日期字段（startDate / endDate / milestone.date）必须走严格 YYYY-MM-DD 校验。
 */
function isValidIsoDateTimeValue(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    !Number.isNaN(Date.parse(value))
  )
}

function weeklyTargetIssues(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) return [`${path} 必须是数组`]
  if (value.length === 0) return [`${path} 至少需要 1 个周目标`]
  return value.flatMap((item, index) => {
    const itemPath = `${path}[${index}]`
    if (!isRecord(item)) return [`${itemPath} 必须是对象`]
    const issues: string[] = []
    if (!isNonEmptyString(item.id)) issues.push(`${itemPath}.id 必须是非空字符串`)
    if (!isNonEmptyString(item.label)) issues.push(`${itemPath}.label 必须是非空字符串`)
    if (!includesValue(WEEKLY_TARGET_UNITS, item.unit)) {
      issues.push(`${itemPath}.unit 只能是 ${WEEKLY_TARGET_UNITS.join('、')} 之一`)
    }
    if (
      typeof item.perWeek !== 'number' ||
      !Number.isInteger(item.perWeek) ||
      item.perWeek < 1 ||
      item.perWeek > MAX_PER_WEEK
    ) {
      issues.push(`${itemPath}.perWeek 需要在 1–${MAX_PER_WEEK} 之间`)
    }
    if (item.module !== undefined && !includesValue(PLAN_MODULES, item.module)) {
      issues.push(`${itemPath}.module 只能是 ${PLAN_MODULES.join('、')} 之一`)
    }
    return issues
  })
}

function milestoneIssues(value: unknown, path: string): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) return [`${path} 必须是数组`]
  return value.flatMap((item, index) => {
    const itemPath = `${path}[${index}]`
    if (!isRecord(item)) return [`${itemPath} 必须是对象`]
    const issues: string[] = []
    if (!isValidIsoDateValue(item.date))
      issues.push(`${itemPath}.date 必须是合法的 YYYY-MM-DD 日期`)
    if (!isNonEmptyString(item.label)) issues.push(`${itemPath}.label 必须是非空字符串`)
    if (item.metric !== undefined && typeof item.metric !== 'string') {
      issues.push(`${itemPath}.metric 必须是字符串`)
    }
    return issues
  })
}

/** 收集一条长期计划的所有问题，空数组表示合法。路径以字段名开头，便于用户定位。 */
function planIssues(value: unknown, path: string): string[] {
  if (!isRecord(value)) return [`${path || '计划'} 必须是 JSON 对象`]
  const p = (key: string) => joinField(path, key)
  const issues: string[] = []

  if (!isNonEmptyString(value.id)) issues.push(`${p('id')} 必须是非空字符串`)
  if (!isNonEmptyString(value.title)) issues.push(`${p('title')} 必须是非空字符串`)
  if (!isNonEmptyString(value.goal)) issues.push(`${p('goal')} 必须是非空字符串`)
  if (!includesValue(PLAN_CADENCES, value.cadence)) {
    issues.push(`${p('cadence')} 只能是 ${PLAN_CADENCES.join(' 或 ')}`)
  }
  if (!includesValue(PLAN_STATUSES, value.status)) {
    issues.push(`${p('status')} 只能是 ${PLAN_STATUSES.join('、')}`)
  }
  if (!includesValue(PLAN_SOURCES, value.source)) {
    issues.push(`${p('source')} 只能是 ${PLAN_SOURCES.join(' 或 ')}`)
  }
  if (!isValidIsoDateValue(value.startDate)) {
    issues.push(`${p('startDate')} 必须是合法的 YYYY-MM-DD 日期`)
  }
  if (value.endDate !== undefined && !isValidIsoDateValue(value.endDate)) {
    issues.push(`${p('endDate')} 必须是合法的 YYYY-MM-DD 日期`)
  }
  if (
    isValidIsoDateValue(value.startDate) &&
    isValidIsoDateValue(value.endDate) &&
    value.startDate > value.endDate
  ) {
    issues.push(`${p('startDate')} 不能晚于 ${p('endDate')}`)
  }
  if (!isValidIsoDateValue(value.createdAt) && !isValidIsoDateTimeValue(value.createdAt)) {
    issues.push(`${p('createdAt')} 需要是合法的 ISO 日期或 ISO 时间字符串`)
  }

  issues.push(...weeklyTargetIssues(value.weeklyTargets, p('weeklyTargets')))
  issues.push(...milestoneIssues(value.milestones, p('milestones')))
  return issues
}

function isLongTermPlan(value: unknown): value is LongTermPlan {
  return isRecord(value) && planIssues(value, '').length === 0
}

/**
 * 计划切片缺失（0.1.0 旧备份）按空数组处理；存在则逐条校验，
 * 报错带上序号和字段路径，例如「备份中的第 2 个长期计划格式不正确：weeklyTargets[0].perWeek …」。
 */
function requireLongTermPlans(value: unknown, label = '备份'): LongTermPlan[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) {
    throw new Error(`${label}中的长期计划格式不正确：longTermPlans 必须是数组`)
  }
  const plans: LongTermPlan[] = []
  value.forEach((item, index) => {
    if (!isLongTermPlan(item)) {
      const detail = isRecord(item) ? planIssues(item, '').join('；') : '每一项都必须是 JSON 对象'
      throw new Error(`${label}中的第 ${index + 1} 个长期计划格式不正确：${detail}。`)
    }
    plans.push(item)
  })
  return plans
}

export const PERSIST_BACKUP_VERSION = '0.2.0'
/** 0.1.0 的备份没有 longTermPlans 字段，导入时按「零个长期计划」兼容。 */
export const LEGACY_BACKUP_VERSION = '0.1.0'

export type PersistBackupPayload = {
  app: 'Persist'
  version: string
  mode: 'frontend-mock'
  exportedAt: string
  data: ImportableMockData & { longTermPlans: LongTermPlan[] }
}

/** 归一化版本号；缺失或非字符串时返回空串（0.1.0 之前的备份没有 version 字段）。 */
export function normalizeBackupVersion(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** 只读取版本号、不做任何校验，供导入提示文案使用；无法解析时返回空串。 */
export function readMockBackupVersion(text: string): string {
  try {
    const payload: unknown = JSON.parse(text)
    return isRecord(payload) ? normalizeBackupVersion(payload.version) : ''
  } catch {
    return ''
  }
}

/**
 * 备份序列化的唯一入口（SettingsPage 的旧内联导出后续改为调用它）。
 * - 字段顺序与旧内联导出完全一致，longTermPlans 追加在 data 末尾；
 * - longTermPlans 缺失时显式写成 []，保证 PersistBackupPayload 的形状是确定的；
 * - 只校验计划切片，其余切片沿用「导出不校验、导入才校验」的既有约定，
 *   避免给导出流程新增失败路径。
 */
export function serializeMockBackup(
  data: ImportableMockData,
  exportedAt: Date = new Date(),
): PersistBackupPayload {
  return {
    app: 'Persist',
    version: PERSIST_BACKUP_VERSION,
    mode: 'frontend-mock',
    exportedAt: exportedAt.toISOString(),
    data: {
      goals: data.goals,
      planItems: data.planItems,
      waterLog: data.waterLog,
      studyRecords: data.studyRecords,
      meals: data.meals,
      fitnessSession: data.fitnessSession,
      profile: data.profile,
      settings: data.settings,
      aiConsent: data.aiConsent,
      eveningReview: data.eveningReview,
      reports: data.reports,
      longTermPlans: requireLongTermPlans(data.longTermPlans, '导出数据'),
    },
  }
}

export function parseMockBackupJson(text: string): ImportableMockData {
  if (!text.trim()) throw new Error('备份文件是空的')

  let payload: unknown
  try {
    payload = JSON.parse(text)
  } catch {
    throw new Error('JSON 无法解析，请选择有效的 UTF-8 JSON 文件')
  }

  if (!isRecord(payload) || payload.app !== 'Persist' || !isRecord(payload.data)) {
    throw new Error('不是 Persist Mock 备份，缺少 app 或 data 数据块')
  }

  const data = payload.data
  if (!isRecord(data.profile) || !isRecord(data.settings)) {
    throw new Error('备份缺少个人档案或设置数据')
  }
  if (typeof data.aiConsent !== 'boolean') {
    throw new Error('备份缺少 AI 授权状态')
  }
  let fitnessSession: FitnessSessionState | null = null
  if (data.fitnessSession !== null) {
    if (!isFitnessSession(data.fitnessSession)) {
      throw new Error('训练会话格式不正确，动作、套组或计时数据不完整')
    }
    fitnessSession = data.fitnessSession
  }
  if (data.eveningReview !== null && !hasStrings(data.eveningReview, ['state', 'note'])) {
    throw new Error('晚间复盘格式不正确')
  }

  const reports = requireArray(data.reports, '报告历史', isReport)
  if (reports.length === 0) throw new Error('报告历史不能为空')

  // 版本号（0.2.0 / 0.1.0 / 缺失）本轮不做门禁：备份真正的契约是 data 的字段形状，
  // 由下面的字段级校验兜底；未知版本也先按同一套规则尽量读入，等迁移阶段再用
  // normalizeBackupVersion / readMockBackupVersion 按版本分流，避免升级后读不了新备份。
  const longTermPlans = requireLongTermPlans(data.longTermPlans)

  return {
    goals: requireArray(
      data.goals,
      '重要目标',
      (item): item is ImportableMockData['goals'][number] =>
        hasStrings(item, ['id', 'title', 'date', 'time', 'tone']) &&
        typeof item.enabled === 'boolean',
    ),
    planItems: requireArray(data.planItems, '今日计划', isPlanItem),
    waterLog: requireArray(
      data.waterLog,
      '饮水记录',
      (item): item is ImportableMockData['waterLog'][number] =>
        hasStrings(item, ['id', 'time']) &&
        typeof item.milliliters === 'number' &&
        Number.isFinite(item.milliliters),
    ),
    studyRecords: requireArray(data.studyRecords, '学习记录', isStudyRecord),
    meals: requireArray(data.meals, '饮食记录', isMeal),
    fitnessSession,
    profile: data.profile as unknown as ProfileData,
    settings: data.settings as unknown as ImportableMockData['settings'],
    aiConsent: data.aiConsent,
    eveningReview: data.eveningReview as ImportableMockData['eveningReview'],
    reports,
    longTermPlans,
  }
}

function parseCsvRows(text: string) {
  const rows: string[][] = []
  const quote = String.fromCharCode(34)
  let row: string[] = []
  let field = ''
  let quoted = false

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    const next = text[index + 1]

    if (character === quote) {
      if (quoted && next === quote) {
        field += quote
        index += 1
      } else {
        quoted = !quoted
      }
      continue
    }

    if (character === ',' && !quoted) {
      row.push(field.trim())
      field = ''
      continue
    }

    if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && next === '\n') index += 1
      row.push(field.trim())
      if (row.some((cell) => cell !== '')) rows.push(row)
      row = []
      field = ''
      continue
    }

    field += character
  }

  row.push(field.trim())
  if (row.some((cell) => cell !== '')) rows.push(row)
  return rows
}

function normalizeHeader(value: string) {
  return value
    .replace(/^\uFEFF/, '')
    .replace(/[\s_/\\-]/g, '')
    .toLowerCase()
}

const CSV_HEADERS = {
  date: ['日期', 'date'],
  category: ['类型', '科目', 'category'],
  source: ['学习来源', '来源', 'source'],
  startTime: ['开始时间', 'starttime'],
  duration: ['学习时长', '学习时长min', '时长', '分钟', 'duration'],
  note: ['备注', 'note'],
  newWords: ['新词', '新学', 'newwords'],
  reviewWords: ['复习词', '复习', 'reviewwords'],
  accuracy: ['正确率', 'accuracy'],
  listening: ['听力', 'listening'],
  chapter: ['章节', 'chapter'],
  questions: ['题目', '题数', 'questions'],
  wrong: ['错题', 'wrong'],
} as const

type CsvKey = keyof typeof CSV_HEADERS

function headerIndex(headers: string[], key: CsvKey) {
  const aliases = CSV_HEADERS[key].map(normalizeHeader)
  return headers.findIndex((header) => aliases.includes(normalizeHeader(header)))
}

function optionalNumber(value: string, label: string, line: number) {
  if (!value.trim()) return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`CSV 第 ${line} 行的${label}必须是有效数字`)
  }
  return parsed
}

function normalizeStudyCategory(value: string): StudyCategory {
  const normalized = value.trim().toLowerCase()
  if (['英语', 'english', '英文', '1'].includes(normalized)) return 'english'
  if (['高数', '数学', 'math', '2'].includes(normalized)) return 'math'
  throw new Error('学习类型只支持“英语”或“高数”')
}

export function parseStudyCsv(text: string): StudyRecord[] {
  const rows = parseCsvRows(text)
  if (rows.length === 0) throw new Error('CSV 文件是空的')

  const headers = rows[0]
  const indexes = {
    date: headerIndex(headers, 'date'),
    category: headerIndex(headers, 'category'),
    source: headerIndex(headers, 'source'),
    startTime: headerIndex(headers, 'startTime'),
    duration: headerIndex(headers, 'duration'),
    note: headerIndex(headers, 'note'),
    newWords: headerIndex(headers, 'newWords'),
    reviewWords: headerIndex(headers, 'reviewWords'),
    accuracy: headerIndex(headers, 'accuracy'),
    listening: headerIndex(headers, 'listening'),
    chapter: headerIndex(headers, 'chapter'),
    questions: headerIndex(headers, 'questions'),
    wrong: headerIndex(headers, 'wrong'),
  }

  const required: Array<[CsvKey, string]> = [
    ['date', '日期'],
    ['category', '类型'],
    ['source', '学习来源'],
    ['startTime', '开始时间'],
    ['duration', '学习时长'],
  ]
  const missing = required.filter(([key]) => indexes[key] === -1)
  if (missing.length > 0) {
    throw new Error(`CSV 缺少表头：${missing.map(([, label]) => label).join('、')}`)
  }

  const read = (row: string[], key: CsvKey) => {
    const index = indexes[key]
    return index === -1 ? '' : (row[index] ?? '').trim()
  }

  const records = rows.slice(1).map<StudyRecord>((row, rowIndex) => {
    const line = rowIndex + 2
    const date = read(row, 'date').replace(/\//g, '-')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new Error(`CSV 第 ${line} 行的日期应为 YYYY-MM-DD`)
    }

    const rawTime = read(row, 'startTime')
    const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(rawTime)
    if (!timeMatch || Number(timeMatch[1]) > 23 || Number(timeMatch[2]) > 59) {
      throw new Error(`CSV 第 ${line} 行的开始时间应为 HH:mm`)
    }
    const startTime = `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}`

    const duration = Number(read(row, 'duration'))
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error(`CSV 第 ${line} 行的学习时长必须大于 0`)
    }

    let category: StudyCategory
    try {
      category = normalizeStudyCategory(read(row, 'category'))
    } catch (error) {
      throw new Error(`CSV 第 ${line} 行：${(error as Error).message}`)
    }

    const source = read(row, 'source')
    if (!source) throw new Error(`CSV 第 ${line} 行缺少学习来源`)

    const base: StudyRecord = {
      id: `study-import-${Date.now()}-${rowIndex + 1}`,
      category,
      source,
      date,
      startTime,
      duration: Math.round(duration),
      note: read(row, 'note') || '通过 CSV 导入',
    }

    if (category === 'english') {
      return {
        ...base,
        newWords: optionalNumber(read(row, 'newWords'), '新词数', line),
        reviewWords: optionalNumber(read(row, 'reviewWords'), '复习词数', line),
        accuracy: optionalNumber(read(row, 'accuracy'), '正确率', line),
        listening: optionalNumber(read(row, 'listening'), '听力时长', line),
      }
    }

    return {
      ...base,
      chapter: read(row, 'chapter') || undefined,
      questions: optionalNumber(read(row, 'questions'), '题目数', line),
      wrong: optionalNumber(read(row, 'wrong'), '错题数', line),
    }
  })

  if (records.length === 0) throw new Error('CSV 没有可导入的学习记录')
  return records
}

/**
 * 统计一份 Mock 数据里的记录条数（首页快照与设置页文案共用同一口径）：
 * 重要目标、今日计划、饮水（固定 1 条基线）、饮水记录、学习记录、饮食条目、
 * 已完成训练套组、个人档案字段，以及长期计划（旧备份没有该字段时按 0 计）。
 */
export function countMockRecords(data: ImportableMockData) {
  const doneSets =
    data.fitnessSession?.exercises.reduce(
      (total, exercise) => total + exercise.sets.filter((set) => set.done).length,
      0,
    ) ?? 0
  const foodEntries = data.meals.reduce((total, meal) => total + meal.entries.length, 0)

  return (
    data.goals.length +
    data.planItems.length +
    1 +
    data.waterLog.length +
    data.studyRecords.length +
    foodEntries +
    doneSets +
    countProfileFields(data.profile) +
    (data.longTermPlans?.length ?? 0)
  )
}
