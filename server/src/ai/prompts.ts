import type { ChatMessage } from './deepseek.js'
import type { ChatRequest, ProfileData } from '../contract.js'

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
