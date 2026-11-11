/**
 * AI 报告与板块观察类型统一从 shared 契约重导出，
 * 前端不再维护第二份容易漂移的字段定义。
 */
export {
  REPORT_RANGE_DAYS,
  REPORT_TYPES,
} from '@persist/shared/contract/report'
export type {
  ReportContent,
  ReportDietDigest,
  ReportDigest,
  ReportFitnessDigest,
  ReportProfileData,
  ReportRangeDays,
  ReportRequest,
  ReportResponse,
  ReportStudyDigest,
  ReportType,
} from '@persist/shared/contract/report'
