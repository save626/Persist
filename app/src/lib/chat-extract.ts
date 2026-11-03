import type { ChatPlanProposal, ChatQuestion, ChatTurn, ProfileFieldKey } from './chat-types'
import type { ProfileData } from '../types'
import { toIsoDate } from './long-term-plan'
import { sanitizeProfilePatch } from './profile-rules'

/**
 * 本地规则引擎：把中文自然语言描述解析成档案字段与计划草案。
 *
 * 这里刻意保持纯函数、无网络、无随机数：
 * - 结果可被单元测试完全固定，行为可预测；
 * - 未来换成真实模型时，只需替换 ChatClient 实现，本文件可整体删除。
 */

const CN_DIGITS: Record<string, number> = {
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
}

function parseCount(raw: string | undefined): number | null {
  if (!raw) return null
  if (CN_DIGITS[raw] !== undefined) return CN_DIGITS[raw]
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

function firstNumber(text: string, patterns: RegExp[]): number | null {
  for (const pattern of patterns) {
    const match = pattern.exec(text)
    if (!match) continue
    const value = parseCount(match[1])
    if (value !== null) return value
  }
  return null
}

function firstText(text: string, pattern: RegExp | RegExp[]): string | null {
  const patterns = Array.isArray(pattern) ? pattern : [pattern]
  for (const item of patterns) {
    const match = item.exec(text)
    const value = match?.[1]?.trim()
    if (value) return value
  }
  return null
}

const GOAL_RULES: { pattern: RegExp; label: string }[] = [
  { pattern: /减脂|减肥|降体脂|瘦下来|瘦一点|减到|瘦到|降重/, label: '减脂' },
  { pattern: /增肌|变壮|长肌肉|增重/, label: '增肌' },
  { pattern: /体态|圆肩|驼背|塑形|仪态/, label: '改善体态' },
  { pattern: /耐力|心肺|跑步|马拉松|体能/, label: '提升耐力' },
  { pattern: /力量|卧推|深蹲|硬拉|举铁/, label: '提升力量' },
  { pattern: /英语|六级|四级|雅思|托福|听力|单词/, label: '英语提分' },
  { pattern: /高数|数学|考研|期末|考试|刷题/, label: '备考提分' },
  { pattern: /习惯|坚持|自律|规律/, label: '养成习惯' },
  { pattern: /睡眠|作息|早睡/, label: '改善作息' },
]

const EQUIPMENT_RULES: { pattern: RegExp; label: string }[] = [
  { pattern: /健身房|健身馆|商业健身|器械区/, label: '商业健身房' },
  { pattern: /哑铃|杠铃|壶铃|弹力带/, label: '居家哑铃' },
  { pattern: /家里|居家|宿舍|自重|无器械|徒手/, label: '居家自重' },
  { pattern: /操场|户外|公园|跑步机|骑车/, label: '户外/操场' },
]

const DIET_RULES: { pattern: RegExp; label: string }[] = [
  { pattern: /高蛋白|蛋白粉|鸡胸/, label: '高蛋白' },
  { pattern: /素食|吃素|不吃肉/, label: '素食' },
  { pattern: /低碳|生酮|少碳水/, label: '低碳水' },
  { pattern: /不吃辣|清淡/, label: '清淡不吃辣' },
  { pattern: /食堂|外卖|公司餐/, label: '食堂外卖为主' },
]

function pickRule(text: string, rules: { pattern: RegExp; label: string }[]) {
  return rules.filter((rule) => rule.pattern.test(text)).map((rule) => rule.label)
}

/** 从一段自由描述里抽取档案字段，缺失的字段不会出现在返回值里。 */
export function parseProfileFromText(text: string): Partial<ProfileData> {
  if (!text.trim()) return {}
  const patch: Partial<ProfileData> = {}

  const age = firstNumber(text, [/(\d{1,2})\s*岁/, /年龄\s*[:：]?\s*(\d{1,2})/])
  if (age !== null && age > 0 && age <= 99) patch.age = age

  const height = firstNumber(text, [
    /身高\s*[:：]?\s*(\d{3}(?:\.\d)?)/,
    /(\d{3}(?:\.\d)?)\s*(?:cm|厘米|公分)/,
  ])
  if (height !== null && height >= 120 && height <= 230) patch.height = height

  const weight = firstNumber(text, [
    /体重\s*[:：]?\s*(\d{2,3}(?:\.\d{1,2})?)/,
    /(\d{2,3}(?:\.\d{1,2})?)\s*(?:kg|KG|公斤|千克)/,
  ])
  if (weight !== null && weight >= 35 && weight <= 250) patch.weight = weight

  const targetWeight = firstNumber(text, [
    /目标体重\s*[:：]?\s*(\d{2,3}(?:\.\d{1,2})?)/,
    /(?:想|希望)?(?:瘦|减|增|练|长)到\s*(\d{2,3}(?:\.\d{1,2})?)/,
    /目标\s*[:：]?\s*(\d{2,3}(?:\.\d{1,2})?)\s*(?:kg|公斤|千克)/,
  ])
  if (targetWeight !== null && targetWeight >= 35 && targetWeight <= 250) {
    patch.targetWeight = targetWeight
  }

  const goals = pickRule(text, GOAL_RULES)
  if (goals.length > 0) patch.goal = goals.slice(0, 2).join(' + ')

  const experienceYears = firstNumber(text, [
    /(?:训练|健身|练了|坚持)\D{0,4}?(\d{1,2})\s*年/,
    /(\d{1,2})\s*年\s*(?:训练|健身|经验)/,
  ])
  if (experienceYears !== null) patch.experience = `系统训练 ${experienceYears} 年`
  else if (/新手|零基础|小白|刚开始|没练过/.test(text))
    patch.experience = '新手，需要从动作模式开始'
  else if (/老手|有经验|练了几年/.test(text)) patch.experience = '有经验，可自主安排'

  const frequency = firstNumber(text, [
    /每周\D{0,4}?([一二两三四五六七1-7])\s*次/,
    /一周\D{0,4}?([一二两三四五六七1-7])\s*次/,
    /([1-7一二两三四五六七])\s*次\s*(?:\/|每)\s*周/,
  ])
  if (frequency !== null && frequency >= 1 && frequency <= 7)
    patch.frequency = `每周 ${frequency} 次`

  const equipment = pickRule(text, EQUIPMENT_RULES)[0]
  if (equipment) patch.equipment = equipment

  const diets = pickRule(text, DIET_RULES)
  if (diets.length > 0) patch.dietPreference = diets.slice(0, 2).join('、')

  const allergy =
    firstText(text, /(?:对)?([^。；;，,\s]{1,10}?)\s*过敏/) ??
    firstText(text, /(?:忌口|不能吃|不吃)\s*[:：]?\s*([^。；;，,\n]{1,20})/)
  if (allergy) patch.allergies = allergy

  const bedtime = firstText(text, [
    /(\d{1,2}\s*[:：]\s*\d{2})\s*(?:之前)?\s*(?:睡|入睡)/,
    /(\d{1,2}\s*点)\s*(?:之前)?\s*(?:睡|入睡)/,
    /(?:睡|入睡)(?:时间)?\s*(?:在)?\s*(\d{1,2}\s*(?:[:：]\s*\d{2}|点))/,
  ])
  if (bedtime) {
    patch.bedtime = bedtime.replace(/\s+/g, '').replace('：', ':').replace(/点$/, '点')
  }

  const sleepHours = firstNumber(text, [
    /(?:睡|睡眠)\D{0,6}?(\d{1,2}(?:\.\d)?)\s*(?:个)?\s*(?:小时|h)/,
    /睡眠\s*[:：]?\s*(\d{1,2}(?:\.\d)?)/,
  ])
  if (sleepHours !== null && sleepHours >= 3 && sleepHours <= 14) patch.sleepHours = sleepHours

  const stress = firstText(text, /(压力(?:很|比较|挺)?大|焦虑|加班|期末周|考试周|熬夜|作息乱)/)
  if (stress) patch.stress = `${stress}（来自对话描述）`

  return patch
}

export function mergeProfile(base: ProfileData, patch: Partial<ProfileData>): ProfileData {
  const next: ProfileData = { ...base }
  for (const [key, value] of Object.entries(patch) as [ProfileFieldKey, unknown][]) {
    if (value === undefined || value === null) continue
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (trimmed) next[key] = trimmed as never
      continue
    }
    if (typeof value === 'number' && Number.isFinite(value) && value !== 0) {
      next[key] = value as never
    }
  }
  return next
}

export const FIELD_LABELS: Record<ProfileFieldKey, string> = {
  age: '年龄',
  height: '身高',
  weight: '当前体重',
  targetWeight: '目标体重',
  goal: '目标',
  experience: '训练经验',
  frequency: '每周可执行次数',
  equipment: '器械条件',
  dietPreference: '饮食偏好',
  allergies: '过敏与忌口',
  bedtime: '入睡时间',
  sleepHours: '平均睡眠',
  stress: '近期压力',
}

interface QuestionSpec {
  field: ProfileFieldKey | 'plan'
  prompt: string
  hint?: string
  options?: string[]
}

const QUESTION_SPECS: QuestionSpec[] = [
  {
    field: 'goal',
    prompt: '你最想先解决哪一个目标？',
    hint: '一句话就够，后面我会拆成每周动作。',
    options: ['减脂', '增肌', '改善体态', '备考提分'],
  },
  {
    field: 'frequency',
    prompt: '一周能稳定留出几次训练时间？',
    hint: '按真实情况说，宁可少一点。',
    options: ['每周 2 次', '每周 3 次', '每周 4 次', '每周 5 次'],
  },
  {
    field: 'equipment',
    prompt: '训练主要在什么条件下进行？',
    options: ['商业健身房', '居家哑铃', '居家自重', '户外/操场'],
  },
  {
    field: 'weight',
    prompt: '现在体重和目标体重分别是多少？',
    hint: '例如：现在 72.5kg，目标 70kg。',
  },
  {
    field: 'experience',
    prompt: '之前的训练经验大概是什么水平？',
    options: ['新手，几乎没练过', '断断续续练过', '系统训练 1-2 年', '系统训练 3 年以上'],
  },
  {
    field: 'sleepHours',
    prompt: '最近平均每天睡多久？',
    hint: '睡眠会直接影响训练量安排。',
  },
  {
    field: 'dietPreference',
    prompt: '饮食上有什么偏好或限制？',
    options: ['高蛋白', '食堂外卖为主', '素食', '清淡不吃辣'],
  },
  {
    field: 'allergies',
    prompt: '有过敏或忌口吗？没有就回「没有」。',
  },
  {
    field: 'stress',
    prompt: '最近压力主要来自哪里？',
    hint: '比如加班、考试周、作息紊乱。',
  },
  {
    field: 'plan',
    prompt: '这个计划你打算持续多久？',
    hint: '例如 8 周、12 周、3 个月。',
    options: ['8 周', '12 周', '3 个月', '半年'],
  },
]

export interface ChatAnalysisInput {
  turns: ChatTurn[]
  profile: ProfileData
  askedFields?: string[]
}

export interface ChatAnalysis {
  userText: string
  mentionedFields: ProfileFieldKey[]
  patch: Partial<ProfileData>
  mergedProfile: ProfileData
  questions: ChatQuestion[]
  proposal: ChatPlanProposal | null
  warnings: string[]
  reply: string
}

const PROPOSAL_TRIGGERS =
  /(生成|整理|给我|看一下|出个|出一版|出份|就这样|可以了|没问题|好了|开始吧|开始生成)/

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function frequencyNumber(profile: ProfileData) {
  const match = /(\d)/.exec(profile.frequency)
  const value = match ? Number(match[1]) : 3
  return clamp(value, 2, 6)
}

function parseDurationWeeks(text: string): { weeks: number; explicit: boolean } {
  const weeks = /(\d{1,2})\s*(?:周|个?星期)/.exec(text)
  if (weeks) return { weeks: clamp(Number(weeks[1]), 2, 52), explicit: true }
  const months = /(\d{1,2})\s*个?月/.exec(text)
  if (months) return { weeks: clamp(Number(months[1]) * 4, 4, 52), explicit: true }
  if (/半年/.test(text)) return { weeks: 26, explicit: true }
  return { weeks: 12, explicit: false }
}

export function findConflicts(profile: ProfileData): string[] {
  const warnings: string[] = []
  const goalText = `${profile.goal}`

  if (/减脂|减肥|降体脂/.test(goalText) && profile.targetWeight >= profile.weight) {
    warnings.push(
      `目标是减脂，但目标体重 ${profile.targetWeight}kg 不低于当前 ${profile.weight}kg，建议把目标体重调到当前体重以下。`,
    )
  }
  if (/增肌/.test(goalText) && profile.targetWeight < profile.weight) {
    warnings.push(
      `目标是增肌，但目标体重低于当前体重，增肌阶段通常不追求体重下降，请确认哪个优先。`,
    )
  }
  if (frequencyNumber(profile) >= 5 && profile.sleepHours > 0 && profile.sleepHours < 6.5) {
    warnings.push(
      `每周 ${frequencyNumber(profile)} 次训练配上不到 ${profile.sleepHours} 小时睡眠，恢复大概率跟不上，建议先降到 3-4 次或把睡眠补到 7 小时。`,
    )
  }
  if (/素食/.test(profile.dietPreference) && /增肌/.test(goalText)) {
    warnings.push('素食 + 增肌需要额外规划豆制品与蛋白补充，否则蛋白摄入很难达标。')
  }
  if (/居家|自重/.test(profile.equipment) && /健身房|器械/.test(profile.dietPreference)) {
    warnings.push('器械条件写的是居家，但饮食偏好在提健身房，请确认训练场地。')
  }
  if (profile.stress && profile.stress.length > 0) {
    warnings.push('你提到近期压力偏大，计划里我会把每周动作数量压到可完成的下限。')
  }
  return warnings
}

export function buildProposal(
  profile: ProfileData,
  text: string,
  patch: Partial<ProfileData> = {},
): ChatPlanProposal {
  const freq = frequencyNumber(profile)
  const goalText = `${profile.goal} ${text}`
  const duration = parseDurationWeeks(text)
  const { patch: safePatch } = sanitizeProfilePatch(patch)
  const weeklyTargets: ChatPlanProposal['weeklyTargets'] = [
    {
      label: '力量训练',
      unit: '次',
      perWeek: freq,
      module: 'fitness',
    },
  ]

  if (/减脂|减肥|耐力|心肺|跑步/.test(goalText)) {
    weeklyTargets.push({
      label: '有氧',
      unit: '分钟',
      perWeek: freq * 25 + 40,
      module: 'fitness',
    })
  }
  if (/英语|六级|四级|雅思|托福|听力|单词/.test(goalText)) {
    weeklyTargets.push({ label: '英语精听', unit: '篇', perWeek: 4, module: 'study' })
  }
  if (/高数|数学|考研|期末|考试|刷题|备考/.test(goalText)) {
    weeklyTargets.push({ label: '刷题', unit: '篇', perWeek: 20, module: 'study' })
  }
  if (weeklyTargets.length === 1) {
    weeklyTargets.push({ label: '学习/复盘', unit: '分钟', perWeek: 120, module: 'study' })
  }

  const start = new Date()
  const end = new Date(start)
  end.setDate(end.getDate() + duration.weeks * 7 - 1)
  const middle = new Date(start)
  middle.setDate(middle.getDate() + Math.floor(duration.weeks / 2) * 7)

  const milestones: ChatPlanProposal['milestones'] = [
    {
      date: toIsoDate(middle),
      label: `第 ${Math.max(1, Math.floor(duration.weeks / 2))} 周复盘`,
      metric: '按周目标完成率 ≥ 80%',
    },
    {
      date: toIsoDate(end),
      label: `${duration.weeks} 周阶段检查`,
      metric: '目标体重与训练量同时复核',
    },
  ]

  const assumptions = [
    `按「${profile.frequency}」的节奏排期，默认你能稳定执行`,
    `器械条件按「${profile.equipment}」安排动作`,
    duration.explicit
      ? `周期按你提到的 ${duration.weeks} 周`
      : `没提到周期，先按 12 周给，可随时改`,
  ]

  const highlights = weeklyTargets.map(
    (target) => `${target.label} ${target.perWeek} ${target.unit}/周`,
  )

  return {
    title: `${profile.goal.split(' + ')[0] || '阶段'}计划`,
    goal: profile.goal,
    cadence: 'cycle',
    startDate: toIsoDate(start),
    endDate: toIsoDate(end),
    weeklyTargets,
    milestones,
    profilePatch: safePatch,
    assumptions,
    warnings: findConflicts(profile),
    highlights,
  }
}

function describePatch(patch: Partial<ProfileData>): string {
  const parts: string[] = []
  for (const [key, value] of Object.entries(patch) as [ProfileFieldKey, unknown][]) {
    if (value === undefined || value === null || value === '') continue
    const label = FIELD_LABELS[key] ?? key
    parts.push(`${label} ${value}`)
  }
  return parts.join('、')
}

export function analyzeChat(input: ChatAnalysisInput): ChatAnalysis {
  const userText = input.turns
    .filter((turn) => turn.role === 'user')
    .map((turn) => turn.content)
    .join('\n')
  const patch = sanitizeProfilePatch(parseProfileFromText(userText)).patch
  const mergedProfile = mergeProfile(input.profile, patch)
  const mentionedFields = Object.keys(patch) as ProfileFieldKey[]
  const warnings = findConflicts(mergedProfile)
  const asked = new Set(input.askedFields ?? [])
  const wantsProposal = PROPOSAL_TRIGGERS.test(userText)
  const criticalReady =
    mentionedFields.includes('goal') &&
    (mentionedFields.includes('frequency') || mentionedFields.includes('equipment'))

  const questions: ChatQuestion[] = []
  if (!wantsProposal) {
    for (const spec of QUESTION_SPECS) {
      if (questions.length >= 2) break
      if (spec.field === 'plan') continue
      if (asked.has(spec.field)) continue
      if (mentionedFields.includes(spec.field)) continue
      questions.push({
        id: `q-${spec.field}`,
        field: spec.field,
        prompt: spec.prompt,
        ...(spec.hint ? { hint: spec.hint } : {}),
        ...(spec.options ? { options: spec.options } : {}),
      })
    }
  }

  const proposal =
    wantsProposal || criticalReady ? buildProposal(mergedProfile, userText, patch) : null

  const understood = describePatch(patch)
  const lines: string[] = []
  if (understood) {
    lines.push(`我记下来了：${understood}。`)
  } else if (userText.trim()) {
    lines.push('这段描述里我还没抓到可执行的档案信息，不过不影响继续聊。')
  }

  if (proposal) {
    lines.push(
      `我按你现在的档案整理了一版「${proposal.title}」，周目标是 ${proposal.highlights.join('、')}。`,
    )
    lines.push('这只是草案，我不会自动改你的档案或计划——你确认后我才写入。')
  } else if (questions.length > 0) {
    lines.push('为了把计划排到能执行，我需要先确认下面两点。')
  } else {
    lines.push('信息基本齐了，你可以直接说「生成计划」，我就整理成一份草案。')
  }

  return {
    userText,
    mentionedFields,
    patch,
    mergedProfile,
    questions,
    proposal,
    warnings,
    reply: lines.join('\n'),
  }
}
