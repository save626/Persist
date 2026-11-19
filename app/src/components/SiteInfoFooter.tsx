import { readSiteInfo, siteInfoLinks } from '../lib/site-info'

/**
 * 网站合规信息（ICP / 公安备案号）展示位。
 *
 * 只在 web 产物里出现：移动端是 APK，走应用商店的分发与备案口径，
 * 不该在这里挂网站备案号。
 *
 * **备案号没下发时不渲染任何东西**——既不显示编号，也不显示占位文案。
 * 原因有两个：
 *   1. 备案号未下发就展示「待下发」属于对外可见的半成品，页面上留这种字样
 *      反而说明网站没备案完；
 *   2. 空态渲染会让 141 张视觉基线全部变化，而基线本该只反映设计改动。
 * 等备案号下发后，填 deploy/site-info.json 重建即可出现，无需改代码。
 *
 * 位置在主内容区底部（不是侧边栏）：窄屏（≤900px）侧边栏是 display:none，
 * 放那里手机用户就看不到备案号，而备案要求是「页面底部可见」。
 */
export function SiteInfoFooter() {
  const links = siteInfoLinks(readSiteInfo())
  if (links.length === 0) {
    return null
  }

  return (
    <div className="site-info">
      {links.map((link, index) => (
        <span key={link.href}>
          {index > 0 && <span className="site-info-sep">·</span>}
          <a href={link.href} target="_blank" rel="noreferrer noopener">
            {link.label}
          </a>
        </span>
      ))}
    </div>
  )
}
