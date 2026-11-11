import { expect, test, type Page } from '@playwright/test'

async function mainNav(page: Page, path: '/' | '/fitness' | '/diet' | '/study' | '/reports') {
  const mobile = (page.viewportSize()?.width ?? 1280) <= 900
  const nav = mobile ? page.locator('.bottom-nav') : page.locator('.side-nav')
  await nav.locator(`a[href="${path}"]`).click()
}

test('demo mode preloads complete data and serves prebuilt AI without API calls', async ({
  page,
}) => {
  const apiCalls: string[] = []
  await page.route('**/api/**', (route) => {
    apiCalls.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`)
    return route.abort()
  })

  await page.goto('/?mode=demo')
  await expect(page.locator('.countdowns .countdown')).toHaveCount(2)
  await expect(page.locator('.plan-panel .badge')).toHaveText('3 / 7')
  await expect(page.getByRole('region', { name: '今日进度' })).toContainText('2.0')

  const quickRecordFab = page.locator('.fab')
  if ((page.viewportSize()?.width ?? 1280) <= 900) {
    await expect(quickRecordFab).toBeVisible()
    await expect(quickRecordFab).toBeDisabled()
  } else {
    await expect(quickRecordFab).toBeHidden()
  }

  // Product navigation drops the query string; the session mode must remain demo.
  await mainNav(page, '/fitness')
  await expect(page).toHaveURL(/\/fitness$/)

  await mainNav(page, '/study')
  await expect(page.locator('.study-timeline-row')).toHaveCount(2)
  await expect(page.locator('.study-timeline-row').filter({ hasText: '百词斩' })).toBeVisible()
  await expect(
    page.locator('.study-timeline-row').filter({ hasText: '高数错题复盘' }),
  ).toBeVisible()
  await expect(page.getByText('这个分类今天还没有记录')).toHaveCount(0)
  await page.goto('/')
  await expect(page.locator('.plan-panel .badge')).toHaveText('3 / 7')
  await expect(page.getByRole('region', { name: '今日进度' })).toContainText('2.0')

  await page.goto('/settings')
  await expect(page.locator('input.toggle-input[aria-label="跨设备同步"]')).toBeDisabled()

  await page.goto('/reports')
  await expect(page.locator('.reports-mock-badge')).toContainText('部署前预生成 · 只读')
  await page.getByRole('button', { name: '查看预生成简报', exact: true }).click()
  const detail = page.getByRole('dialog')
  await expect(detail).toContainText('部署前通过 deepseek-chat 生成')
  await expect(detail).toContainText('部署后只读，不再调用 AI')
  await expect(detail.getByRole('button', { name: '应用建议' })).toHaveCount(0)
  await page.keyboard.press('Escape')

  const prebuiltAnalysis = page.getByRole('region', { name: '服务端综合分析' })
  await expect(prebuiltAnalysis).toContainText('部署前通过 DeepSeek')
  await expect(prebuiltAnalysis).not.toContainText('正在生成服务端综合分析')

  await page.goto('/')
  await page.getByRole('button', { name: '晨间简报' }).click()
  const brief = page.getByRole('dialog', { name: '晨间简报' })
  await expect(brief).toContainText('部署前通过 DeepSeek 生成并固化')
  await page.keyboard.press('Escape')

  await page.goto('/plans')
  await expect(page.getByText('部署前预生成 · 只读')).toBeVisible()
  await page.getByRole('button', { name: '查看预置建档' }).first().click()
  const chat = page.getByRole('dialog', { name: 'AI 建档对话' })
  await expect(chat).toContainText('部署前真实生成 · 当前只读')
  await expect(chat).toContainText('12 周增肌与体态改善计划')
  await expect(chat.getByLabel('对话输入')).toHaveCount(0)
  await page.keyboard.press('Escape')

  expect(apiCalls).toEqual([])

  const databaseNames = await page.evaluate(async () =>
    (await indexedDB.databases()).map((database) => database.name),
  )
  expect(databaseNames).not.toContain('persist-app')
  expect(databaseNames).not.toContain('persist-app-demo')
})

test('guest mode starts empty and never calls AI endpoints', async ({ page }) => {
  const apiCalls: string[] = []
  await page.route('**/api/**', (route) => {
    apiCalls.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`)
    return route.abort()
  })

  await page.goto('/?mode=guest')
  await expect(page.locator('.countdowns .countdown')).toHaveCount(0)
  await expect(page.locator('.plan-panel .badge')).toHaveText('0 / 0')
  await expect(page.getByRole('region', { name: '今日进度' })).toContainText('0.0')

  await mainNav(page, '/fitness')
  await expect(page.locator('.fit-exercise')).toHaveCount(0)
  await expect(page.getByText('杠铃平板卧推')).toHaveCount(0)
  await expect(page.getByText('常用模板')).toHaveCount(0)
  await expect(page.getByText('还没有动作。点击“记录运动”添加第一组训练。')).toBeVisible()
  await expect(page.locator('.fit-week')).toContainText('0 次')
  await expect(page.locator('.fit-week')).toContainText('暂无')
  await expect(page.locator('.fit-muscles')).toContainText('0 组')
  await expect(page.locator('.fit-muscles')).toContainText('完成训练后显示肌群分布。')

  await page.goto('/settings')
  await expect(page.locator('input.toggle-input[aria-label="跨设备同步"]')).toBeDisabled()
  await expect(page.locator('.settings-sync-disclosure')).toContainText(
    '桌面演示 / 体验模式不创建同步账号',
  )

  await page.goto('/reports')
  await expect(page.locator('.reports-mock-badge')).toContainText('本地生成 · Mock 报告')
  await expect(page.getByText('桌面体验模式固定使用本地 Mock')).toBeVisible()
  await page.getByRole('button', { name: '生成今日简报', exact: true }).click()
  await expect(page.getByText('今日简报已生成')).toBeVisible()

  await page.goto('/')
  await page.getByRole('button', { name: '晨间简报' }).click()
  const brief = page.getByRole('dialog', { name: '晨间简报' })
  await expect(brief).toBeVisible()
  await expect(brief.locator('.surface-note')).toContainText('桌面体验模式固定使用本机 Mock')
  await page.keyboard.press('Escape')

  await page.goto('/plans')
  await page.locator('.plans-head-actions').getByRole('button', { name: 'AI 建档' }).click()
  const chat = page.getByRole('dialog', { name: 'AI 建档对话' })
  await expect(chat).toBeVisible()
  await chat.getByLabel('对话输入').fill('我想每周训练三次，帮我把计划整理出来')
  await chat.getByRole('button', { name: '发送', exact: true }).click()
  await expect(chat.getByRole('button', { name: '去确认草案' })).toBeVisible()
  await page.keyboard.press('Escape')

  expect(apiCalls).toEqual([])

  const databaseNames = await page.evaluate(async () =>
    (await indexedDB.databases()).map((database) => database.name),
  )
  expect(databaseNames).toContain('persist-app-guest')
  expect(databaseNames).not.toContain('persist-app')
})
