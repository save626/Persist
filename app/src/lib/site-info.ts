/**
 * 网站合规信息（ICP / 公安备案号）在 React 端的读取与渲染。
 *
 * 数据来自 deploy/site-info.json，由 app/vite.config.ts 在构建期内联成
 * `__SITE_INFO__` 常量——和静态落地页共用同一个来源、同一套格式校验。
 * 备案号下发后只改那一个 JSON，重建 web 产物即可。
 *
 * 这里只放「取数据」和「拼展示」，不做格式判断：格式校验在构建期已经
 * 失败过一次了（vite.config.ts 里 parseSiteInfo 会抛错中止构建）。
 */

/** 构建期注入的合规信息。字段与 deploy/site-info.json 一致。 */
export interface SiteInfo {
  /** ICP 备案号，未取得时为空串。 */
  icpNumber: string
  /** 公安备案号，未取得时为空串。 */
  policeNumber: string
}

/** 构建期注入的全局常量。declare 只是给 TS 一个类型，运行期由 Vite 替换。 */
declare const __SITE_INFO__: SiteInfo

/** 一条备案信息链接。 */
export interface SiteInfoLink {
  /** 展示文案（备案号本身）。 */
  label: string
  /** 指向的备案查询站点。 */
  href: string
}

/**
 * 读取构建期注入的合规信息。
 *
 * `__SITE_INFO__` 由 Vite 的 define 注入，**vitest 用的是同一份 vite.config**，
 * 所以单测里它同样存在（早期注释写「不作用于 vitest」是错的——那时的测试
 * 之所以绿，只是因为 site-info.json 的编号恰好为空，并不是真的走到了降级分支）。
 * 降级路径因此单独由 normalizeSiteInfo 覆盖，见同文件下方。
 */
export function readSiteInfo(): SiteInfo {
  return normalizeSiteInfo(typeof __SITE_INFO__ === 'undefined' ? undefined : __SITE_INFO__)
}

/**
 * 把「可能不存在的注入值」归一化成完整的 SiteInfo。
 *
 * 没有注入值时返回全空——调用方据此完全不渲染（不显示编号也不显示占位文案），
 * 既不会抛 ReferenceError，也不会把半成品挂到页面上。
 */
export function normalizeSiteInfo(injected: SiteInfo | undefined): SiteInfo {
  if (!injected) {
    return { icpNumber: '', policeNumber: '' }
  }
  return injected
}

/**
 * 生成对外展示的备案信息链接列表。
 * 两项都为空表示尚未取得——返回空数组，由调用方决定显示什么占位文案。
 */
export function siteInfoLinks(info: SiteInfo): SiteInfoLink[] {
  const links: SiteInfoLink[] = []
  if (info.icpNumber) {
    links.push({ label: info.icpNumber, href: 'https://beian.miit.gov.cn/' })
  }
  if (info.policeNumber) {
    links.push({ label: info.policeNumber, href: 'https://beian.mps.gov.cn/' })
  }
  return links
}
