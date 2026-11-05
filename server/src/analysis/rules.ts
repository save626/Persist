import type { ReportContentV2, ReportFactsV2 } from '@persist/shared/contract/analysis'

/**
 * 规则模板报告（P4 §8.5）：没有 AI Key、模型超时/上游失败时的降级内容。
 *
 * 只做两件事：复述事实包里已经算好的数字、按固定规则给出泛化建议。
 * 不新增任何事实包里没有的数字，也不做跨模块推断——这样「origin: rules」时
 * 报告仍然诚实，用户不会把模板话当成 AI 分析。
 */

function num(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function signed(value: number): string {
  return `${value > 0 ? '+' : ''}${num(value)}`
}

export function buildRulesContent(facts: ReportFactsV2): ReportContentV2 {
  const windowDays = facts.range.days
  const covered = facts.totals.daysWithAnyRecord
  const coverageRate = windowDays > 0 ? covered / windowDays : 0
  const status = coverageRate >= 0.7 ? '记录较稳定' : coverageRate >= 0.4 ? '记录偏少' : '记录稀疏'

  const moduleParts: string[] = []
  if (facts.consent.fitness) moduleParts.push(`完成训练 ${num(facts.totals.fitnessSessions)} 次`)
  if (facts.consent.study) moduleParts.push(`学习 ${num(facts.totals.studyMinutes)} 分钟`)
  if (facts.consent.diet) moduleParts.push(`饮水日均 ${num(facts.totals.waterAvgMl)} 毫升`)

  const coverageSentence =
    coverageRate >= 0.7
      ? '整体记录连贯，可以据此观察长期趋势。'
      : '记录还有缺口，以下判断主要基于有记录的日子。'
  const trendSentence =
    facts.trend.planRateChangePct === null
      ? ''
      : `计划完成率环比 ${signed(facts.trend.planRateChangePct)}%。`
  const summary = `近 ${windowDays} 天里有 ${covered} 天留下记录，${
    moduleParts.length > 0 ? moduleParts.join('、') : '但没有可分析的模块数据'
  }。${coverageSentence}${trendSentence}`

  const coverageFields: string[] = []
  if (facts.coverage.fitnessDays !== null)
    coverageFields.push(`训练 ${num(facts.coverage.fitnessDays)} 天`)
  if (facts.coverage.studyDays !== null)
    coverageFields.push(`学习 ${num(facts.coverage.studyDays)} 天`)
  if (facts.coverage.dietDays !== null)
    coverageFields.push(`饮食 ${num(facts.coverage.dietDays)} 天`)
  if (facts.coverage.waterDays !== null)
    coverageFields.push(`饮水 ${num(facts.coverage.waterDays)} 天`)
  const missingSentence =
    facts.totals.daysMissing > 0
      ? `另有 ${num(facts.totals.daysMissing)} 天没有留下记录，这些日子的情况无法判断。`
      : '窗口内每天都有记录。'
  const coverageParagraph = `记录覆盖：窗口内共 ${covered}/${windowDays} 天有记录，${
    coverageFields.length > 0 ? coverageFields.join('、') : '各模块都没有可统计的记录'
  }。${missingSentence}`

  const analysis: string[] = [coverageParagraph]

  const trainingParts: string[] = []
  if (facts.consent.fitness) {
    trainingParts.push(
      `完成训练 ${num(facts.totals.fitnessSessions)} 次、累计 ${num(facts.totals.fitnessMinutes)} 分钟、总容量 ${num(facts.totals.volumeKg)} kg`,
    )
  }
  if (facts.consent.study) {
    trainingParts.push(
      `学习累计 ${num(facts.totals.studyMinutes)} 分钟（英语 ${num(facts.totals.studyEnglishMinutes)} 分钟、数学 ${num(facts.totals.studyMathMinutes)} 分钟）`,
    )
  }
  if (trainingParts.length > 0) {
    const trendParts: string[] = []
    if (facts.trend.fitnessSessionsChangePct !== null) {
      trendParts.push(`训练次数环比 ${signed(facts.trend.fitnessSessionsChangePct)}%`)
    }
    if (facts.trend.studyMinutesChangePct !== null) {
      trendParts.push(`学习时长环比 ${signed(facts.trend.studyMinutesChangePct)}%`)
    }
    analysis.push(
      `投入情况：${trainingParts.join('；')}。${
        trendParts.length > 0
          ? `${trendParts.join('，')}。`
          : '没有可比的上一窗口，趋势暂时无法判断。'
      }`,
    )
  }

  const dietParts: string[] = []
  if (facts.consent.diet) {
    dietParts.push(
      `饮食有记录的 ${num(facts.coverage.dietDays)} 天日均 ${num(facts.totals.dietAvgCalories)} 千卡、蛋白 ${num(facts.totals.dietAvgProtein)} 克`,
    )
    dietParts.push(`饮水日均 ${num(facts.totals.waterAvgMl)} 毫升`)
  }
  if (facts.totals.planRate !== null) {
    dietParts.push(`计划项完成率 ${num(facts.totals.planRate)}%`)
  }
  if (dietParts.length > 0) {
    analysis.push(
      `饮食与计划：${dietParts.join('；')}。这些数字只统计有记录的日子，没有记录的日子没有按 0 处理。`,
    )
  }

  analysis.push(
    `综合来看，${coverageRate >= 0.7 ? '记录连续性较好' : '记录连续性一般'}，训练、学习与饮食的节奏只能说明记录里的情况。以上推断只基于记录本身，不涉及身体状况的医学判断，也不替代专业意见。`,
  )

  const conclusions: string[] = [
    `记录覆盖 ${covered}/${windowDays} 天，${
      coverageRate >= 0.7 ? '数据基础足够支撑趋势判断' : '样本偏少，结论仅供参考'
    }。`,
  ]
  if (facts.trend.fitnessSessionsChangePct !== null) {
    conclusions.push(
      `训练次数环比 ${signed(facts.trend.fitnessSessionsChangePct)}%，变化来自窗口内完成记录。`,
    )
  } else {
    conclusions.push('没有可比的上一窗口，暂时判断不出趋势方向。')
  }
  if (facts.totals.planRate !== null) {
    conclusions.push(
      `计划项完成率 ${num(facts.totals.planRate)}%，${facts.totals.planRate >= 60 ? '执行比较稳定' : '执行还有提升空间'}。`,
    )
  }
  if (conclusions.length < 2) {
    conclusions.push('目前只能说明记录本身，跨模块关联还需要更多连续数据。')
  }

  const actions: string[] = ['先保证每天至少留下一条训练或学习记录，把缺口补上。']
  if (facts.consent.fitness) {
    actions.push('训练保持每周频率稳定，避免连续多天完全休息。')
  }
  if (facts.consent.study) {
    actions.push('英语和数学交替安排，单次不少于半小时。')
  }
  if (facts.consent.diet) {
    actions.push('饮食记录按餐补齐，饮水少量多次记在同一天里。')
  }
  while (actions.length < 2) {
    actions.push('把记录时间固定在晚上同一时段，降低漏记概率。')
  }

  return {
    title: `${windowDays} 天综合分析`,
    status,
    summary,
    analysis: analysis.slice(0, 5),
    conclusions: conclusions.slice(0, 4),
    actions: actions.slice(0, 4),
    warnings: [],
  }
}
