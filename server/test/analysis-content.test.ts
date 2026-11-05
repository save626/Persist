import { describe, expect, it } from 'vitest'
import { AiError } from '../src/ai/deepseek.js'
import {
  AnalysisContentError,
  assertNumbersSourced,
  findUnsourcedNumbers,
  generateAnalysisContent,
  sanitizeAnalysisContent,
} from '../src/ai/analysis.js'
import { buildAnalysisFacts } from '../src/analysis/facts.js'
import { buildRulesContent } from '../src/analysis/rules.js'
import { openDatabase } from '../src/db/driver.js'
import { migrate } from '../src/db/migrations.js'
import type { ReportFactsV2 } from '@persist/shared/contract/analysis'
import {
  NOW,
  USER,
  contentJson,
  fakeAi,
  seedRecords,
  seedUser,
  validContent,
} from './helpers/analysis-fixtures.js'

/** 基于夹具记录的事实包；不传 rangeDays 用 30 天（逐日 + 周汇总都齐）。 */
function factsFor(rangeDays: 7 | 30 | 90 = 30): ReportFactsV2 {
  const db = openDatabase({ path: ':memory:' })
  try {
    migrate(db)
    seedUser(db)
    seedRecords(db, USER)
    return buildAnalysisFacts(db, USER, { rangeDays, now: NOW })
  } finally {
    db.close()
  }
}

describe('sanitizeAnalysisContent：结构契约', () => {
  it('合规输出原样通过，并补齐缺省的 warnings', () => {
    const content = validContent()
    expect(sanitizeAnalysisContent(content)).toEqual(content)
    expect(sanitizeAnalysisContent({ ...content, warnings: undefined }).warnings).toEqual([])
  })

  it('超长字段截断到上限而不是整份作废', () => {
    const long = '这是一句很长的分析'.repeat(60)
    const cleaned = sanitizeAnalysisContent({
      ...validContent(),
      summary: long,
      analysis: [
        long,
        '第二段同样写得足够长，用来占住数组的第二位，确保整份内容的结构仍然合法，不会触发长度校验。',
      ],
    })
    expect(cleaned.summary).toHaveLength(260)
    expect(cleaned.analysis[0]).toHaveLength(320)
  })

  it('结论/建议/警告超过四条的溢出部分被截断，不是整份作废', () => {
    const cleaned = sanitizeAnalysisContent({
      ...validContent(),
      conclusions: [
        '结论一保持记录',
        '结论二保持记录',
        '结论三保持记录',
        '结论四保持记录',
        '结论五保持记录',
      ],
      warnings: ['警告一内容', '警告二内容', '警告三内容', '警告四内容', '警告五内容'],
    })
    expect(cleaned.conclusions).toHaveLength(4)
    expect(cleaned.warnings).toHaveLength(4)
  })

  it.each([
    ['不是对象', 'oops'],
    ['标题缺失', { ...validContent(), title: undefined }],
    ['标题过短', { ...validContent(), title: '分' }],
    ['摘要过短', { ...validContent(), summary: '太短了' }],
    [
      '分析段数太少',
      { ...validContent(), analysis: ['只有一段，但长度足够长，用来触发段数不足的错误提示。'] },
    ],
    [
      '分析段数太多',
      {
        ...validContent(),
        analysis: Array.from(
          { length: 6 },
          (_, i) => `第 ${i} 段分析内容，长度足够触发段数过多错误。`,
        ),
      },
    ],
    [
      '分析段落重复',
      { ...validContent(), analysis: [validContent().analysis[0], validContent().analysis[0]] },
    ],
    ['结论只有一条', { ...validContent(), conclusions: ['只有一条结论'] }],
    ['建议过短', { ...validContent(), actions: ['短', '短'] }],
    ['含代码块', { ...validContent(), summary: '```json\n{"a":1}\n```' }],
  ])('%s：判为契约违规', (_label, raw) => {
    expect(() => sanitizeAnalysisContent(raw)).toThrow(AnalysisContentError)
  })
})

describe('数字白名单：正文只能引用事实包里的数', () => {
  it('规则模板生成的正文不会包含事实包以外的数字', () => {
    for (const rangeDays of [7, 30, 90] as const) {
      const facts = factsFor(rangeDays)
      const content = buildRulesContent(facts)
      expect(() => sanitizeAnalysisContent(content)).not.toThrow()
      expect(findUnsourcedNumbers(content, facts)).toEqual([])
    }
  })

  it('模型自算的数字被识别为编造', () => {
    const facts = factsFor(7)
    const content = {
      ...validContent(),
      summary:
        '近 7 天的训练完成 1 次，总容量约 999 公斤，平均每天 42 分钟，整体较为稳定，可以继续保持。',
    }
    expect(findUnsourcedNumbers(content, facts)).toEqual(['999', '42'])
    expect(() => assertNumbersSourced(content, facts)).toThrow(/999、42/)
  })

  it('事实包里出现过的数字（含小数）放行', () => {
    const facts = factsFor(7)
    const content = {
      ...validContent(),
      summary:
        '近 7 天训练 1 次、学习 45 分钟、饮水 250 毫升，饮食平均 600 千卡，记录节奏稳定，可以按计划继续推进。',
    }
    expect(findUnsourcedNumbers(content, facts)).toEqual([])
    expect(() => assertNumbersSourced(content, facts)).not.toThrow()
  })
})

describe('generateAnalysisContent：模型调用与失败路径', () => {
  it('合规输出返回净化后的内容，并透传 maxTokens / timeoutMs', async () => {
    const facts = factsFor(7)
    const ai = fakeAi([contentJson()])
    const content = await generateAnalysisContent(ai, facts, {
      model: 'deepseek-chat',
      maxTokens: 3_000,
      timeoutMs: 30_000,
    })
    expect(content).toEqual(validContent())
    expect(ai.calls).toBe(1)
    expect(ai.lastOptions).toMatchObject({ maxTokens: 3_000, timeoutMs: 30_000 })
  })

  it('默认给 2_600 tokens 额度', async () => {
    const facts = factsFor(7)
    const ai = fakeAi([contentJson()])
    await generateAnalysisContent(ai, facts, { model: 'deepseek-chat' })
    expect(ai.lastOptions?.maxTokens).toBe(2_600)
  })

  it('上游 JSON 不合法：抛 AiError invalid_response，不吞成降级', async () => {
    const facts = factsFor(7)
    const ai = fakeAi([new AiError('invalid_response', '不是合法 JSON')])
    await expect(
      generateAnalysisContent(ai, facts, { model: 'deepseek-chat' }),
    ).rejects.toMatchObject({ name: 'AiError', code: 'invalid_response' })
  })

  it('编造数字：抛 AnalysisContentError，调用方据此返回 502', async () => {
    const facts = factsFor(7)
    const ai = fakeAi([
      contentJson({ ...validContent(), summary: `${validContent().summary} 折合 1234 千卡。` }),
    ])
    await expect(
      generateAnalysisContent(ai, facts, { model: 'deepseek-chat' }),
    ).rejects.toBeInstanceOf(AnalysisContentError)
  })
})
