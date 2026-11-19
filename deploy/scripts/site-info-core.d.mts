/**
 * site-info-core.mjs 的类型声明。
 *
 * 实现是纯 JS（.mjs），但 app/vite.config.ts 是 TypeScript 且参与 tsc -b，
 * 没有声明文件会被隐式推断成 any 并报错（TS7016）。
 */

export interface SiteInfo {
  icpNumber: string
  policeNumber: string
}

export declare const ICP_PATTERN: RegExp
export declare const POLICE_PATTERN: RegExp

export declare function parseSiteInfo(raw: unknown): SiteInfo

export declare function siteInfoLinks(
  info: SiteInfo,
): Array<{ label: string; href: string }>
