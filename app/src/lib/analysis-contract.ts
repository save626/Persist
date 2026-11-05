/**
 * 前端侧的综合分析契约入口（步骤 13 / P4b）。
 *
 * 与 `sync-contract.ts` 同一套路：类型、常量、纯校验函数全部来自 `@persist/shared`，
 * 不在 app 里另抄一份。服务端事实包与报告正文的字段名、长度上限、错误码都由共享契约定义，
 * 前端只负责按契约展示，避免前后端一跑偏就把半截结构渲染成「看起来正常」的报告。
 */
export type {
  AnalysisConsent,
  AnalysisConsentModule,
  AnalysisErrorBody,
  AnalysisFactsResponse,
  AnalysisGranularity,
  AnalysisMetric,
  AnalysisOrigin,
  AnalysisRangeDays,
  AnalysisReportDetail,
  AnalysisReportListItem,
  AnalysisRequest,
  AnalysisReportResponse,
  AnalysisReportType,
  AnalysisReportsListResponse,
  DailyBriefSettings,
  FactsDay,
  FactsDietDay,
  FactsFitnessDay,
  FactsPlan,
  FactsPlanDay,
  FactsProfile,
  FactsStudyDay,
  FactsTotals,
  FactsTrend,
  FactsWeek,
  FactsWeeklyTarget,
  FactsCoverage,
  ReportContentV2,
  ReportFactsV2,
} from '@persist/shared/contract/analysis'

export {
  ANALYSIS_CONSENT_MODULES,
  ANALYSIS_CONTENT_LIMITS,
  ANALYSIS_ERROR_CODES,
  ANALYSIS_GRANULARITIES,
  ANALYSIS_RANGE_DAYS,
  ANALYSIS_REPORT_TYPE,
  DATA_RETENTION,
  DEFAULT_DAILY_BRIEF_AT,
  isAnalysisRangeDays,
  normalizeDailyBriefSettings,
  parseDailyBriefAt,
  parseAnalysisRequest,
} from '@persist/shared/contract/analysis'
