import { describe, expect, it } from 'vitest'
import { readSiteInfo, siteInfoLinks } from './site-info'

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
  it('未注入构建期常量时安全降级为全空（不抛 ReferenceError）', () => {
    // 测试环境没有 Vite define 注入 __SITE_INFO__，这里验证降级路径。
    const info = readSiteInfo()
    expect(info.icpNumber).toBe('')
    expect(info.policeNumber).toBe('')
    expect(siteInfoLinks(info)).toEqual([])
  })
})
