/**
 * 同步实体的「信封」契约：服务端落库与前端 outbox 用的是同一份 kind 列表。
 *
 * 注意：这里只有形状，不含业务字段校验。业务字段（日期、枚举、数值范围）
 * 在服务端 `normalizeEntity` 里校验，失败记为 skipped(invalid)，不影响同批其它实体。
 */

export const ENTITY_KINDS = [
  'profile',
  'settings',
  'plan_item',
  'study_record',
  'fitness_session',
  'diet_entry',
  'water_log',
  'goal',
  'long_term_plan',
] as const

export type EntityKind = (typeof ENTITY_KINDS)[number]

const ENTITY_KIND_SET = new Set<string>(ENTITY_KINDS)

export function isEntityKind(value: unknown): value is EntityKind {
  return typeof value === 'string' && ENTITY_KIND_SET.has(value)
}

/** `profile` / `settings` 全局只有一份，不需要 id。 */
export const SINGLE_ROW_KINDS: ReadonlySet<EntityKind> = new Set<EntityKind>([
  'profile',
  'settings',
])

export interface EntityCandidate {
  kind: EntityKind
  /** 单行实体可以省略；非单行实体必须给（也可以只放在 data.id 里）。 */
  id?: string | null
  /** 客户端毫秒时间戳，LWW 裁决只认它。 */
  updatedAt: number
  deleted?: boolean
  data?: unknown
}
