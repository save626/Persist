import type { AnalysisMetric, ReportFactsV2 } from '@persist/shared/contract/analysis'
import { windowLength } from './facts.js'

/**
 * 报告头部的指标卡：全部从事实包派生，前端不做二次计算。
 *
 * 未授权模块给「未纳入分析」而不是 0——否则用户会以为「AI 说我那几天没练」。
 */

function num(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function notAuthorized(module: 'profile' | 'fitness' | 'diet' | 'study'): string {
  return `${module === 'profile' ? '档案' : module === 'fitness' ? '训练' : module === 'diet' ? '饮食' : '学习'}未纳入分析`
}

function studyCategoryMinutes(facts: ReportFactsV2): { english: number; math: number } {
  const total = { english: 0, math: 0 }
  for (const day of facts.days) {
    if (!day.study?.byCategory) continue
    total.english += day.study.byCategory.english
    total.math += day.study.byCategory.math
  }
  // 90 天窗口不返回逐日明细，分科汇总直接用 totals 里服务端算好的值。
  if (facts.days.length === 0) {
    total.english = facts.totals.studyEnglishMinutes ?? 0
    total.math = facts.totals.studyMathMinutes ?? 0
  }
  return total
}

function dietAverages(facts: ReportFactsV2): { calories: number | null; protein: number | null } {
  if (facts.days.length === 0) {
    return {
      calories: facts.totals.dietAvgCalories ?? null,
      protein: facts.totals.dietAvgProtein ?? null,
    }
  }
  const days = facts.days.filter((day) => day.diet !== null)
  if (days.length === 0) return { calories: null, protein: null }
  let calories = 0
  let protein = 0
  for (const day of days) {
    calories += day.diet?.calories ?? 0
    protein += day.diet?.protein ?? 0
  }
  return {
    calories: Math.round((calories / days.length) * 10) / 10,
    protein: Math.round((protein / days.length) * 10) / 10,
  }
}

export function buildAnalysisMetrics(facts: ReportFactsV2): AnalysisMetric[] {
  const metrics: AnalysisMetric[] = []
  const windowDays = windowLength(facts)

  const coverageParts: string[] = []
  if (facts.coverage.fitnessDays !== null)
    coverageParts.push(`训练 ${num(facts.coverage.fitnessDays)} 天`)
  if (facts.coverage.studyDays !== null)
    coverageParts.push(`学习 ${num(facts.coverage.studyDays)} 天`)
  if (facts.coverage.dietDays !== null)
    coverageParts.push(`饮食 ${num(facts.coverage.dietDays)} 天`)
  if (facts.coverage.waterDays !== null)
    coverageParts.push(`饮水 ${num(facts.coverage.waterDays)} 天`)
  metrics.push({
    label: '记录覆盖',
    value: `${num(facts.totals.daysWithAnyRecord)}/${windowDays} 天`,
    detail: coverageParts.length > 0 ? coverageParts.join(' · ') : '窗口内没有可分析记录',
  })

  if (facts.consent.fitness) {
    const detailParts: string[] = []
    if (facts.totals.fitnessMinutes !== null)
      detailParts.push(`总时长 ${num(facts.totals.fitnessMinutes)} 分钟`)
    if (facts.totals.volumeKg !== null) detailParts.push(`容量 ${num(facts.totals.volumeKg)} kg`)
    metrics.push({
      label: '训练',
      value: `${num(facts.totals.fitnessSessions)} 次`,
      detail: detailParts.length > 0 ? detailParts.join(' · ') : '窗口内没有完成记录',
    })
  } else {
    metrics.push({ label: '训练', value: '未纳入', detail: notAuthorized('fitness') })
  }

  if (facts.consent.study) {
    const categories = studyCategoryMinutes(facts)
    const hasCategories = facts.days.some((day) => day.study?.byCategory !== null)
    metrics.push({
      label: '学习',
      value: `${num(facts.totals.studyMinutes)} 分钟`,
      detail: hasCategories
        ? `英语 ${num(categories.english)} 分钟 · 数学 ${num(categories.math)} 分钟`
        : '窗口内没有学习记录',
    })
  } else {
    metrics.push({ label: '学习', value: '未纳入', detail: notAuthorized('study') })
  }

  if (facts.consent.diet) {
    const averages = dietAverages(facts)
    metrics.push({
      label: '饮食',
      value: averages.calories === null ? '无记录' : `日均 ${num(averages.calories)} 千卡`,
      detail:
        averages.protein === null ? '窗口内没有饮食记录' : `蛋白日均 ${num(averages.protein)} 克`,
    })
    metrics.push({
      label: '饮水',
      value:
        facts.totals.waterAvgMl === null ? '无记录' : `日均 ${num(facts.totals.waterAvgMl)} ml`,
      detail:
        facts.coverage.waterDays === null || facts.coverage.waterDays === 0
          ? '窗口内没有饮水记录'
          : `有记录 ${num(facts.coverage.waterDays)} 天`,
    })
  } else {
    metrics.push({ label: '饮食', value: '未纳入', detail: notAuthorized('diet') })
    metrics.push({ label: '饮水', value: '未纳入', detail: notAuthorized('diet') })
  }

  if (facts.totals.planRate !== null) {
    const trend = facts.trend.planRateChangePct
    metrics.push({
      label: '计划完成',
      value: `${num(facts.totals.planRate)}%`,
      detail: trend === null ? '没有可比的上一窗口' : `环比 ${trend > 0 ? '+' : ''}${num(trend)}%`,
    })
  } else if (facts.plan) {
    metrics.push({ label: '计划完成', value: '无数据', detail: '窗口内没有计划项' })
  }

  if (facts.trend.fitnessSessionsChangePct !== null) {
    const change = facts.trend.fitnessSessionsChangePct
    metrics.push({
      label: '训练趋势',
      value: `${change > 0 ? '+' : ''}${num(change)}%`,
      detail: '对比前一个等长窗口',
    })
  } else if (facts.trend.studyMinutesChangePct !== null) {
    const change = facts.trend.studyMinutesChangePct
    metrics.push({
      label: '学习趋势',
      value: `${change > 0 ? '+' : ''}${num(change)}%`,
      detail: '对比前一个等长窗口',
    })
  }

  return metrics
}
