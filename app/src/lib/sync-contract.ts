/**
 * 前端侧的同步契约入口：类型、常量与纯校验函数都来自 `@persist/shared`，
 * 不在 app 里另抄一份（否则前后端字段名一跑偏，幂等与游标就会互相不认）。
 *
 * 12c 先把「共用同一份定义」这条管道打通；12d 的 sync-client / sync-queue 全部经由这里取类型。
 */
export type {
  BootstrapBody,
  DeviceCredentials,
  DeviceRegisterBody,
  DeviceRegisterResponse,
  DeviceRestoreBody,
  DeviceRevokeBody,
  EntityCandidate,
  EntityKind,
  PullEntity,
  PullQuery,
  PullResponseBody,
  PushBody,
  PushResult,
  SkippedEntity,
  SkipReason,
} from '@persist/shared/contract/sync'

export {
  DEFAULT_PULL_LIMIT,
  ENTITY_KINDS,
  MAX_BOOTSTRAP_ENTITIES,
  MAX_ENTITY_ID_LENGTH,
  MAX_OP_ID_LENGTH,
  MAX_PULL_LIMIT,
  MAX_PUSH_ENTITIES,
  SINGLE_ROW_KINDS,
  isEntityKind,
  parseEntityCandidate,
  parsePullQuery,
  parsePushBody,
} from '@persist/shared/contract/sync'
