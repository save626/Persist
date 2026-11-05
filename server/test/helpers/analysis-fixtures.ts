import type { AiClient, AiJsonOptions } from '../../src/ai/deepseek.js'
import type { Db } from '../../src/db/driver.js'
import { upsertEntity } from '../../src/db/repositories/entities.js'
import type { ReportContentV2 } from '@persist/shared/contract/analysis'

/**
 * 综合分析测试夹具：固定时钟 + 一套覆盖训练/学习/饮食/饮水/计划的当天记录，
 * 以及一份「数字全部来自事实包」的合规模型输出。
 *
 * 时钟固定为 2026-11-05 21:00（Asia/Shanghai），本地日期是 2026-11-05，
 * 7 天窗口是 2026-10-30 – 2026-11-05。
 */

export const USER = 'usr_analysis'
export const NOW = Date.UTC(2026, 10, 5, 13, 0, 0)
export const TODAY = '2026-11-05'
export const YESTERDAY = '2026-11-04'

export function seedUser(db: Db, id: string = USER): string {
  db.prepare('INSERT INTO users (id, created_at) VALUES (?, ?)').run(id, 1)
  return id
}

export interface SeedOptions {
  /** 额外在前一个等长窗口写入 2 次训练，用来验证 trend。 */
  withPreviousWindow?: boolean
  /** 跳过所有当天记录（空窗口场景）。 */
  empty?: boolean
}

function fitnessSession(id: string, date: string) {
  return {
    kind: 'fitness_session' as const,
    id,
    updatedAt: 1_000,
    data: {
      id,
      date,
      status: 'completed',
      completedAt: `${date}T12:00:00.000Z`,
      exercises: [
        {
          id: `${id}_ex`,
          name: '深蹲',
          sets: [{ id: `${id}_s1`, weight: 60, reps: 5, done: true }],
        },
      ],
    },
  }
}

/** 一套完整的当天记录：训练 1 次、学习 45 分钟、饮食 600 kcal、饮水 250 ml、计划项 1 条。 */
export function seedRecords(db: Db, userId: string, options: SeedOptions = {}): void {
  if (options.withPreviousWindow) {
    // 上一个等长窗口（2026-10-23 – 2026-10-29）：只放训练，用来算 -50% 之类的趋势。
    upsertEntity(db, userId, fitnessSession('fit_prev_1', '2026-10-24'))
    upsertEntity(db, userId, fitnessSession('fit_prev_2', '2026-10-26'))
  }
  if (options.empty) return

  upsertEntity(db, userId, fitnessSession('fit_today', TODAY))
  upsertEntity(db, userId, {
    kind: 'study_record',
    id: 'study_today',
    updatedAt: 1_000,
    data: {
      id: 'study_today',
      category: 'english',
      source: '百词斩',
      date: TODAY,
      startTime: '08:00',
      duration: 45,
      note: '',
      newWords: 20,
    },
  })
  upsertEntity(db, userId, {
    kind: 'diet_entry',
    id: 'diet_today',
    updatedAt: 1_000,
    data: {
      id: 'diet_today',
      date: TODAY,
      meal: 'lunch',
      name: '鸡胸饭',
      calories: 600,
      protein: 40,
      carbs: 60,
      fat: 12,
    },
  })
  upsertEntity(db, userId, {
    kind: 'water_log',
    id: 'water_today',
    updatedAt: 1_000,
    data: { id: 'water_today', date: TODAY, time: '08:00', milliliters: 250 },
  })
  upsertEntity(db, userId, {
    kind: 'plan_item',
    id: 'plan_today',
    updatedAt: 1_000,
    data: {
      id: 'plan_today',
      date: TODAY,
      name: '晚间复盘',
      time: '21:00',
      detail: '10 分钟',
      kind: 'default',
      done: true,
    },
  })
}

export function seedProfile(
  db: Db,
  userId: string,
  profile: Record<string, unknown>,
  updatedAt = 1_000,
): void {
  upsertEntity(db, userId, { kind: 'profile', updatedAt, data: profile })
}

export function seedSettings(db: Db, userId: string, settings: Record<string, unknown>): void {
  upsertEntity(db, userId, { kind: 'settings', updatedAt: 1_000, data: settings })
}

export function seedPlan(db: Db, userId: string, payload: Record<string, unknown>): void {
  upsertEntity(db, userId, { kind: 'long_term_plan', updatedAt: 1_000, data: payload })
}

/**
 * 一份合规的模型输出：正文里的数字（7、1）都在事实包里出现，
 * 每段 40 字以上，结论/建议各 2 条，满足净化器与数字白名单。
 */
export function validContent(): ReportContentV2 {
  return {
    title: '近 7 天综合分析',
    status: '记录较稳定',
    summary:
      '近 7 天的训练、学习与饮食记录整体比较平稳，训练完成 1 次，学习与饮食都有连续记录，说明当前的记录节奏适合继续保持，后续可以把注意力放在执行细节上。',
    analysis: [
      '训练方面，本窗口完成了 1 次训练，容量与时长都来自服务端聚合，说明训练记录的习惯已经建立，后续只需要保持固定的训练时段并留意恢复情况。',
      '学习与饮食方面，英语和数学的记录时长可以对照周目标检查，饮食记录也保持了每天的完整填写，没有出现漏记的情况，记录质量本身是可靠的。',
    ],
    conclusions: ['保持训练与学习的记录频率', '饮食记录继续按天完整填写'],
    actions: ['下周把训练安排固定在两个时段', '每天结束前补记当天的饮水'],
    warnings: [],
  }
}

/** 把内容序列化成模型会返回的 JSON 字符串。 */
export function contentJson(content: ReportContentV2 = validContent()): string {
  return JSON.stringify(content)
}

export interface FakeAi extends AiClient {
  calls: number
  lastOptions: AiJsonOptions | undefined
}

/** 可编排的 AI 桩：第 n 次调用返回 replies[n-1]（越界复用最后一个），或抛错。 */
export function fakeAi(replies: Array<string | Error>): FakeAi {
  const fake: FakeAi = {
    calls: 0,
    lastOptions: undefined,
    async completeJson(_messages, options) {
      fake.calls += 1
      fake.lastOptions = options
      const reply = replies[Math.min(fake.calls - 1, replies.length - 1)]
      if (reply instanceof Error) throw reply
      return JSON.parse(reply as string) as unknown
    },
    // 综合分析只走非流式 JSON，这里直接报错暴露误用。
    // eslint-disable-next-line require-yield
    async *streamChat(): AsyncGenerator<string> {
      throw new Error('streamChat 不应在综合分析里被调用')
    },
  }
  return fake
}
