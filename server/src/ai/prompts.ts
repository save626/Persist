import type { ChatMessage } from './deepseek.js'
import type { ChatRequest, ProfileData, ReportRequest } from '../contract.js'

/**
 * 提示词与提示词上下文构建。
 *
 * 两段调用各司其职：
 * 1. 对话回复：真流式，逐字返回给前端，负责「像人一样说话」；
 * 2. 结构化抽取：非流式 JSON 模式，负责给出 questions / profilePatch / proposal，
 *    结果必须经过 ai/extract.ts 净化后才允许发给前端。
 *
 * 拆成两段是因为：JSON 模式无法边生成边被前端当文本展示，而结构化结果又必须可校验。
 */

export const CHAT_SYSTEM_PROMPT = `你是「Persist」App 的 AI 建档助手，用简体中文回答。
职责：围绕训练、饮食、学习与作息目标，帮用户把模糊想法整理成可执行计划；信息不够时用 1–3 个具体问题追问。

硬性规则：
1. 只依据用户明确说过的信息推断，不编造年龄、体重、伤病、时间安排等数据。
2. 涉及伤病、用药、极端节食、自伤等话题时，明确建议就医或咨询专业人士，不做诊断、不承诺效果。
3. 不输出 Markdown 表格、代码块或 JSON；回复控制在 150 字以内，最多 4 条要点。
4. 不询问真实姓名、手机号、身份证号、住址等隐私信息。
5. 这是辅助建议，不能替代医生、教练或营养师。`

const PROFILE_LABELS: [Exclude<keyof ProfileData, 'aiConsent'>, string][] = [
  ['goal', '目标'],
  ['experience', '训练经验'],
  ['frequency', '每周可执行频率'],
  ['equipment', '器械条件'],
  ['dietPreference', '饮食偏好'],
  ['allergies', '过敏与忌口'],
  ['bedtime', '入睡时间'],
  ['stress', '近期压力'],
  ['age', '年龄'],
  ['height', '身高（cm）'],
  ['weight', '体重（kg）'],
  ['targetWeight', '目标体重（kg）'],
  ['sleepHours', '平均睡眠（小时）'],
]

/** 只把档案里「真的填了」的字段拼进提示词，避免把空字符串当事实喂给模型。 */
export function profileSummary(profile: ProfileData): string {
  const lines: string[] = []
  for (const [field, label] of PROFILE_LABELS) {
    const value = profile[field]
    if (typeof value === 'number') {
      if (Number.isFinite(value) && value > 0) lines.push(`- ${label}：${value}`)
      continue
    }
    const text = value.trim()
    if (text) lines.push(`- ${label}：${text}`)
  }
  if (lines.length === 0) return '（用户还没有填写档案）'
  return lines.join('\n')
}

/** 统一按北京时间判断「今天」，避免服务器时区不同导致日期偏移一天。 */
export function todayInShanghai(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return `${value('year')}-${value('month')}-${value('day')}`
}

function buildSystemPrompt(request: ChatRequest): string {
  return [
    CHAT_SYSTEM_PROMPT,
    '',
    `今天是 ${todayInShanghai()}（Asia/Shanghai）。涉及日期时以今天为基准，不得给出已经过去的日期。`,
    '',
    '当前档案（用户已在 App 里填写，可直接引用）：',
    profileSummary(request.profile),
  ].join('\n')
}

/** 提示词里只带最近若干轮，控制成本；完整历史在 UI 侧保留。 */
const MAX_PROMPT_TURNS = 12

export function buildChatMessages(request: ChatRequest): ChatMessage[] {
  const messages: ChatMessage[] = [{ role: 'system', content: buildSystemPrompt(request) }]
  const recent = request.turns.slice(-MAX_PROMPT_TURNS)
  for (const turn of recent) {
    messages.push({ role: turn.role, content: turn.content })
  }
  return messages
}

export const EXTRACTION_SYSTEM_PROMPT = `你是结构化信息抽取器。只输出一个 JSON 对象，不要输出任何解释、Markdown 代码块或多余文字。
JSON 形状（字段都可省略，但不能出现未列出的字段）：
{
  "questions": [{"field": "goal", "prompt": "……", "hint": "……", "options": ["……"]}],
  "profilePatch": {"goal": "减脂", "frequency": "每周 3 次"},
  "proposal": {
    "title": "8 周减脂计划",
    "goal": "……",
    "cadence": "weekly 或 cycle",
    "startDate": "YYYY-MM-DD",
    "endDate": "YYYY-MM-DD",
    "weeklyTargets": [{"label": "力量训练", "unit": "次", "perWeek": 3, "module": "fitness"}],
    "milestones": [{"date": "YYYY-MM-DD", "label": "第 4 周复盘", "metric": "……"}],
    "assumptions": ["……"],
    "warnings": ["……"],
    "highlights": ["……"]
  },
  "warnings": ["……"]
}

规则：
1. field 只能是：age、height、weight、targetWeight、goal、experience、frequency、equipment、dietPreference、allergies、bedtime、sleepHours、stress、plan。
2. profilePatch 只写用户本轮明确说过的字段，不把没说的信息补全；数字必须在合理范围（年龄 14–100、身高 120–230、体重与目标体重 35–250、睡眠 3–14）。
3. 信息不足时不要编造 proposal：把 proposal 设为 null，用 questions 追问（最多 2 个）。
4. proposal 仅在目标 +（频率或器械条件）至少两项明确时给出；weeklyTargets 1–4 条，unit 只能是 次/分钟/公里/千卡/篇，module 只能是 fitness/study/diet/other，perWeek 为正整数。
5. warnings 只写真实风险（如目标体重方向与目标矛盾、训练量明显超出恢复能力），不写套话。
6. 不输出真实姓名、联系方式、身份证号等隐私；用户提到伤病或用药时，在 warnings 里建议就医。
7. 所有文本用简体中文，单条不超过 60 字。`

/** 抽取提示词额外带上今天日期：模型很容易按训练语料给出已经过去的年份。 */
export function buildExtractionSystemPrompt(today: string = todayInShanghai()): string {
  return [
    EXTRACTION_SYSTEM_PROMPT,
    '',
    `今天是 ${today}。proposal.startDate 不得早于今天；endDate 与 milestones[].date 必须不早于 startDate。`,
  ].join('\n')
}

export function buildExtractionMessages(request: ChatRequest): ChatMessage[] {
  const transcript = request.turns
    .map((turn) => `${turn.role === 'user' ? '用户' : '助手'}：${turn.content}`)
    .join('\n')
  const userContent = [
    '当前档案 JSON：',
    JSON.stringify(request.profile),
    '',
    '对话记录：',
    transcript,
    '',
    '请输出 JSON。',
  ].join('\n')
  return [
    { role: 'system', content: buildExtractionSystemPrompt() },
    { role: 'user', content: userContent },
  ]
}

// ---------------------------------------------------------------------------
// AI 报告（8c）
//
// 报告只让模型写「文字结论」：数字、指标与引用依据由前端按本地记录确定性生成。
// 因此提示词只给已授权的摘要，并反复强调不得编造未给出的数字。
// ---------------------------------------------------------------------------

export const REPORT_SYSTEM_PROMPT = `你是「Persist」App 的复盘助手，用简体中文写一份基于本地记录的简报。
职责：把训练、饮食、学习与个人档案的摘要整理成「今天发生了什么、接下来做什么」，语气克制、具体、可执行。

硬性规则：
1. 只能使用用户数据摘要里直接出现的数字与事实；不得编造，也不得自行做数值推算——包括由摘要数字相减、相加、取平均或按比例算出的数字。要表达缺口时只说「按目标补齐」「把未完成的组数补齐」，不写具体差额。
2. 摘要里没有出现的来源，视为用户未授权：不要提及，也不要推测。
3. 不评价记忆力、意志力或人品；不做医疗诊断，不承诺效果。涉及伤病、用药、极端节食时，写清建议就医或咨询专业人士。
4. 不输出 Markdown 表格、代码块、标题符号或列表符号；只输出一个 JSON 对象。
5. 不输出真实姓名、联系方式、身份证号等隐私，也不要要求用户提供。
6. 只输出下面列出的字段，不额外输出 metric、evidence、date 等字段。

输出 JSON 形状：
{
  "title": "……",
  "status": "……",
  "summary": "……",
  "conclusions": ["……", "……"],
  "actions": ["……", "……"],
  "warnings": []
}

字段要求：
- title：8–20 字，概括今天最值得守住的一件事，不带日期。
- status：4–8 字，如「节奏稳定」「先补饮水」「待推进」。
- summary：120–220 字，一段话，先说事实再说判断，不要分点。
- conclusions：2–3 条，每条 10–60 字，只写能从摘要里看出来的事实与趋势。
- actions：2–3 条，每条 10–60 字，必须具体到时间、动作或已有记录节点；其中的数量只能引用摘要里出现的数字，没有可引用数字时不要编造，可写「按目标补齐」这类表述；不要写「保持良好习惯」这类空话。
- warnings：0–2 条，每条 10–60 字，只写摘要里真实存在的风险；没有风险就给空数组。`

/** 把摘要渲染成紧凑文本：只列已授权来源，避免模型把缺失数据当成「零」。 */
export function reportDigestSummary(request: ReportRequest): string {
  const lines: string[] = []
  const { fitness, study, diet, profile } = request.digest

  if (fitness) {
    lines.push('训练记录：')
    lines.push(`- 今日是否已有训练会话：${fitness.hasSession ? '是' : '否'}`)
    lines.push(
      `- 动作 ${fitness.exerciseCount} 个；完成 ${fitness.doneSets} / ${fitness.totalSets} 组`,
    )
    const extras: string[] = []
    if (fitness.strengthVolumeKg > 0) extras.push(`力量容量 ${fitness.strengthVolumeKg} kg`)
    if (fitness.durationMinutes > 0) extras.push(`累计时长 ${fitness.durationMinutes} 分钟`)
    if (fitness.distanceKm > 0) extras.push(`距离 ${fitness.distanceKm} km`)
    if (extras.length > 0) lines.push(`- ${extras.join('；')}`)
    if (fitness.exerciseNames.length > 0) {
      lines.push(`- 动作名称：${fitness.exerciseNames.join('、')}`)
    }
  }

  if (study) {
    lines.push('学习记录：')
    lines.push(
      `- 共 ${study.recordCount} 条（英语 ${study.englishCount} 条、高数 ${study.mathCount} 条），累计 ${study.totalMinutes} 分钟`,
    )
  }

  if (diet) {
    lines.push('饮食与饮水：')
    lines.push(`- 有食物的餐次 ${diet.mealCount} 个，食物条目 ${diet.foodEntryCount} 个`)
    lines.push(`- 饮水 ${diet.waterLiters.toFixed(2)} L（${diet.waterEvents} 个记录节点）`)
  }

  if (profile) {
    lines.push('个人档案（用户已填写，可直接引用）：')
    lines.push(profileSummary(profile))
  }

  if (lines.length === 0) return '（没有可引用的数据）'
  return lines.join('\n')
}

export function buildReportMessages(
  request: ReportRequest,
  today: string = todayInShanghai(),
): ChatMessage[] {
  const rangeLabel =
    request.rangeDays === 7 ? '近 7 天' : request.rangeDays === 30 ? '近 30 天' : '近 90 天'
  const userContent = [
    `今天是 ${today}（Asia/Shanghai），统计区间为${rangeLabel}。`,
    `报告类型：${request.type}。`,
    '',
    '以下是用户已授权的数据摘要（未列出的来源视为未授权，不要提及）：',
    reportDigestSummary(request),
    '',
    '请输出 JSON。',
  ].join('\n')
  return [
    { role: 'system', content: REPORT_SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ]
}
