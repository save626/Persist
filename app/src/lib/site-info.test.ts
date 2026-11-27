import { describe, expect, it } from 'vitest'
import { ICP_PATTERN } from '../../../deploy/scripts/site-info-core.mjs'
import { normalizeSiteInfo, readSiteInfo, siteInfoLinks } from './site-info'

/**
 * 备案号展示逻辑的单测。
 *
 * 关键约束：备案号未下发时 links 必须是空数组——
 * 组件据此完全不渲染，视觉基线不受影响，也不会在页面上留半成品。
 */
describe('siteInfoLinks', () => {
  it('两项都为空时返回空数组（页面不渲染任何内容）', () => {
    expect(siteInfoLinks({ icpNumber: '', policeNumber: '' })).toEqual([])
  })

  it('只有 ICP 编号时只给一条链接，指向工信部', () => {
    const links = siteInfoLinks({ icpNumber: '浙ICP备2024000000号-1', policeNumber: '' })
    expect(links).toEqual([{ label: '浙ICP备2024000000号-1', href: 'https://beian.miit.gov.cn/' }])
  })

  it('只有公安编号时只给一条链接，指向公安部', () => {
    const links = siteInfoLinks({ icpNumber: '', policeNumber: '浙公网安备33010602000000号' })
    expect(links).toEqual([
      { label: '浙公网安备33010602000000号', href: 'https://beian.mps.gov.cn/' },
    ])
  })

  it('两项都有时按 ICP 在前、公安在后的顺序返回', () => {
    const links = siteInfoLinks({
      icpNumber: '浙ICP备2024000000号-1',
      policeNumber: '浙公网安备33010602000000号',
    })
    expect(links.map((link) => link.href)).toEqual([
      'https://beian.miit.gov.cn/',
      'https://beian.mps.gov.cn/',
    ])
  })
})

describe('readSiteInfo', () => {
  it('注入值要么为空、要么是合法备案号（格式与唯一事实源共用同一套校验）', () => {
    // vite.config.ts 的 define 对 vitest 同样生效，所以这里读到的是真实注入值。
    // 合法性直接复用 deploy/scripts/site-info-core.mjs 的 ICP_PATTERN——
    // app 是浏览器包，不能读 node fs，只能借同一套校验。
    const info = readSiteInfo()
    if (info.icpNumber) {
      expect(info.icpNumber).toMatch(ICP_PATTERN)
    }
    if (info.policeNumber) {
      expect(info.policeNumber).toMatch(/^[一-龥]+公网安备\d{6,}号(-\d+)?$/)
    }
  })
})

describe('normalizeSiteInfo', () => {
  it('未注入构建期常量时安全降级为全空（不抛 ReferenceError）', () => {
    // 降级路径单独覆盖：不是靠「编号恰好为空」蒙混过关。
    const info = normalizeSiteInfo(undefined)
    expect(info.icpNumber).toBe('')
    expect(info.policeNumber).toBe('')
    expect(siteInfoLinks(info)).toEqual([])
  })

  it('有注入值时原样返回，不做二次加工', () => {
    const injected = { icpNumber: '豫ICP备2026060824号', policeNumber: '' }
    expect(normalizeSiteInfo(injected)).toEqual(injected)
  })
})
