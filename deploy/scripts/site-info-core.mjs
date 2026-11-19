/**
 * 网站合规信息（ICP 备案号 / 公安备案号）的解析与校验。
 *
 * 唯一事实来源是 deploy/site-info.json。备案号要等管局下发，是**后补**的，
 * 所以这里只负责「校验 + 归一化」，不负责渲染——渲染由各端各司其职：
 *   - 静态落地页 / 介绍页：deploy/scripts/render-site-info.mjs
 *   - React web：构建期由 app/vite.config.ts 读同一份 JSON，内联成常量
 *
 * 两端共用这份校验，避免「静态页校验通过、构建产物里却是错的」这种漂移。
 */

/** 备案号必须形如「浙ICP备2024000000号-1」，否则宁可不显示。 */
export const ICP_PATTERN = /^[一-龥]+ICP备\d{6,}号(-\d+)?$/
/** 公安备案号形如「浙公网安备33010602000000号」。 */
export const POLICE_PATTERN = /^[一-龥]+公网安备\d{6,}号(-\d+)?$/

/**
 * @typedef {object} SiteInfo
 * @property {string} icpNumber ICP 备案号，未取得时为空串
 * @property {string} policeNumber 公安备案号，未取得时为空串
 */

/**
 * 校验并归一化 site-info.json 的内容。
 * 任何一项格式不合法都直接抛错——宁可构建失败，也不把错的备案号发出去。
 *
 * @param {unknown} raw site-info.json 解析后的内容
 * @returns {SiteInfo}
 */
export function parseSiteInfo(raw) {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('site-info.json 的内容必须是一个对象。')
  }

  const source = /** @type {Record<string, unknown>} */ (raw)

  const icp = typeof source.icpNumber === 'string' ? source.icpNumber.trim() : ''
  const police = typeof source.policeNumber === 'string' ? source.policeNumber.trim() : ''

  if (icp && !ICP_PATTERN.test(icp)) {
    throw new Error(`site-info.json 的 icpNumber「${icp}」格式不合法，已中止。`)
  }
  if (police && !POLICE_PATTERN.test(police)) {
    throw new Error(`site-info.json 的 policeNumber「${police}」格式不合法，已中止。`)
  }

  return { icpNumber: icp, policeNumber: police }
}

/**
 * 生成对外展示的备案信息链接列表。
 * 两项都为空表示尚未取得——返回空数组，由调用方决定显示什么占位文案。
 *
 * @param {SiteInfo} info
 * @returns {Array<{ label: string, href: string }>}
 */
export function siteInfoLinks(info) {
  const links = []
  if (info.icpNumber) {
    links.push({
      label: info.icpNumber,
      href: 'https://beian.miit.gov.cn/',
    })
  }
  if (info.policeNumber) {
    links.push({
      label: info.policeNumber,
      href: 'https://beian.mps.gov.cn/',
    })
  }
  return links
}
