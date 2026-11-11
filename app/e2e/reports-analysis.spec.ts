import { expect, test, type Page } from '@playwright/test'

/**
 * 服务端综合分析的 E2E：真实浏览器里验证四种关键状态。
 *
 * 这里不启动真实服务端，而是像 smoke.spec.ts 一样拦截 `/api/v1/**`：
 * 先用「设备注册」接口开启跨设备同步拿到 token，再让分析接口返回不同结果，
 * 覆盖「服务端 AI」「服务端规则降级」「502 结构不合规」「403 AI 授权关闭」。
 */

const SERVER_LABEL = '服务端分析 · DeepSeek'
const RULES_LABEL = '服务端规则生成（AI 不可用）'
const RULES_NOTE = '服务端未配置模型或模型暂时不可用，本报告由服务端规则基于真实记录生成。'
const INVALID_LABEL = '服务端分析结果不合规，已拒绝展示'
const CONSENT_LABEL = 'AI 授权已关闭，未做服务端分析'

// 正文必须满足 ANALYSIS_CONTENT_LIMITS：summary 40–260 字、analysis 每条 40–320 字、
// conclusions/actions 每条 4–80 字，否则客户端会按 invalid-response 拒绝展示。
const CONTENT = {
  title: '综合分析：训练节奏稳定，睡眠是短板',
  status: '稳步推进',
  summary:
    '过去 7 天完成 3 次力量训练，整体节奏稳定，没有出现连续加量后的疲劳堆积。饮食记录里蛋白质摄入偏低，睡眠平均只有 6.8 小时；接下来优先把入睡时间提前，再考虑增加训练量。',
  analysis: [
    '训练方面本周完成 3 次力量训练，总容量与前几周基本持平，没有出现连续加量后的疲劳堆积，恢复节奏是可以保持的。',
    '饮食方面蛋白质摄入连续多天低于目标，晚餐时间也偏晚，第二天早上的恢复感因此受到影响，先把午餐的蛋白质补足更实际。',
    '学习方面英语记录连续 6 天，高数集中在晚间；晚间学习和训练后的疲劳叠加，是接下来最值得调整的一处安排。',
  ],
  conclusions: [
    '保持每周 3 次训练，暂时不需要额外增加训练日。',
    '把高数主练习提前到晚饭前，避开训练后的疲劳。',
  ],
  actions: [
    '今晚 23:00 前入睡，先补回连续两晚的睡眠缺口。',
    '午餐增加一份鸡胸或鸡蛋，把蛋白质补到目标。',
  ],
  warnings: ['连续两晚睡眠不足 7 小时，优先调整入睡时间。'],
}

const METRICS = [
  { label: '训练完成', value: '3 次', detail: '目标 3 次' },
  { label: '睡眠均值', value: '6.8 h', detail: '低于目标 8 h' },
]

const RECOVERY_CODE = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'

type Scenario = 'ai' | 'rules' | 'invalid' | 'consent'

function buildReport(origin: 'ai' | 'rules') {
  return {
    reportId: `rpt-e2e-${origin}`,
    cached: false,
    origin,
    // 规则降级时服务端拿不到模型名，契约里 model 为 null。
    model: origin === 'ai' ? 'deepseek-chat' : null,
    range: { start: '2026-02-01', end: '2026-02-07', days: 7 },
    content: CONTENT,
    metrics: METRICS,
    dataRev: 1,
    createdAt: Date.now(),
  }
}

/** 拦截全部 /api/v1 请求：同步接口返回可用设备，分析接口按场景返回。 */
function mockDeviceApi(page: Page, scenario: Scenario) {
  return page.route('**/api/v1/**', (route) => {
    const request = route.request()
    const url = request.url()
    const method = request.method()

    if (method === 'POST' && url.endsWith('/devices')) {
      return route.fulfill({
        json: {
          userId: 'u-e2e',
          deviceId: 'd-e2e',
          token: 'token-e2e',
          recoveryCode: RECOVERY_CODE,
        },
      })
    }
    if (url.includes('/devices/revoke')) {
      return route.fulfill({ json: { revoked: true, deviceId: 'd-e2e' } })
    }
    if (url.includes('/sync/bootstrap') || url.includes('/sync/push')) {
      return route.fulfill({ json: { applied: 1, skipped: [], serverRev: 1 } })
    }
    if (url.includes('/sync/pull')) {
      return route.fulfill({ json: { entities: [], nextSince: 1, hasMore: false } })
    }
    if (method === 'POST' && url.endsWith('/analysis/reports')) {
      if (scenario === 'invalid') {
        return route.fulfill({
          status: 502,
          json: { error: { code: 'invalid_response', message: '服务端分析结果不合规' } },
        })
      }
      if (scenario === 'consent') {
        return route.fulfill({
          status: 403,
          json: { error: { code: 'ai_consent_off', message: 'AI 授权已关闭' } },
        })
      }
      return route.fulfill({ json: buildReport(scenario) })
    }
    if (method === 'GET' && /\/reports(\?|$)/.test(url)) {
      return route.fulfill({ json: { reports: [], nextCursor: null } })
    }
    return route.fulfill({ status: 404, json: { error: { code: 'not_found', message: 'x' } } })
  })
}

/** 在设置页开启跨设备同步，拿到服务端 token 后服务端分析才会启用。 */
async function enableSync(page: Page) {
  await page.goto('/settings')
  const syncCard = page.locator('.settings-sync-card')
  await syncCard.getByRole('checkbox', { name: '跨设备同步' }).click()
  await expect(syncCard.locator('.settings-sync-code code')).toBeVisible()
}

test('server analysis shows AI report with paragraphs and metrics', async ({ page }) => {
  await mockDeviceApi(page, 'ai')
  await enableSync(page)
  await page.goto('/reports')

  await expect(page.getByRole('heading', { name: '服务端综合分析', exact: true })).toBeVisible()
  await expect(page.getByText(SERVER_LABEL).first()).toBeVisible()
  await expect(page.getByText(CONTENT.title)).toBeVisible()
  await expect(page.getByText(CONTENT.analysis[0])).toBeVisible()
  await expect(
    page.locator('.reports-analysis-metrics').getByText('训练完成', { exact: true }),
  ).toBeVisible()
  await expect(
    page.locator('.reports-analysis-metrics').getByText('3 次', { exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: '重新分析' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '服务端归档' })).toBeVisible()
  await expect(page.getByText('服务端还没有归档报告，生成一次后就会出现在这里。')).toBeVisible()
  // 命中缓存标签只在 cached=true 时出现，本次不应出现。
  await expect(page.getByText('缓存结果（数据未变）')).toHaveCount(0)
})

test('server rules fallback is labeled as rules, not AI', async ({ page }) => {
  await mockDeviceApi(page, 'rules')
  await enableSync(page)
  await page.goto('/reports')

  await expect(page.getByText(RULES_LABEL).first()).toBeVisible()
  await expect(page.getByText(RULES_NOTE)).toBeVisible()
  await expect(page.getByText(CONTENT.analysis[0])).toBeVisible()
  await expect(page.getByText(SERVER_LABEL)).toHaveCount(0)
})

test('invalid server payload is rejected and local brief stays visible', async ({ page }) => {
  await mockDeviceApi(page, 'invalid')
  await enableSync(page)
  await page.goto('/reports')

  await expect(page.getByText(INVALID_LABEL).first()).toBeVisible()
  await expect(page.getByRole('button', { name: '重试' })).toBeVisible()
  // 本地简报仍在页面上，服务端失败不影响已生成的本机内容。
  await expect(page.locator('.reports-brief')).toBeVisible()
  await expect(page.getByText(SERVER_LABEL)).toHaveCount(0)
})

test('consent-off response explains AI authorization is closed', async ({ page }) => {
  await mockDeviceApi(page, 'consent')
  await enableSync(page)
  await page.goto('/reports')

  await expect(page.getByText(CONSENT_LABEL).first()).toBeVisible()
  await expect(page.getByRole('button', { name: '去个人档案开启 AI 授权' })).toBeVisible()
  await expect(page.getByText(SERVER_LABEL)).toHaveCount(0)
})
