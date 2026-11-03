import { expect, test, type Page } from '@playwright/test'

/** 防抖写入是 200ms，留一倍余量等 IndexedDB 事务真正落盘。 */
const PERSIST_FLUSH_MS = 450

async function waitForPersistFlush(page: Page) {
  await page.waitForTimeout(PERSIST_FLUSH_MS)
}

test('刷新后保留本机记录的饮水量，且重复刷新不会累加', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: '晨间简报' })).toBeVisible()

  await page.getByRole('button', { name: '快速记录', exact: true }).first().click()
  await expect(page.getByRole('dialog', { name: '记录什么？' })).toBeVisible()
  await page.getByRole('button', { name: '饮水', exact: true }).click()
  await expect(page.getByText('已记录 250 ml 饮水')).toBeVisible()
  const progress = page.getByRole('region', { name: '今日进度' })
  await expect(progress).toContainText('1.5')

  // 目标 2 L、基线 1.2 L，再记录 250 ml 后缺口应为 550 ml。
  const brief = page.getByRole('dialog', { name: '晨间简报' })
  await page.getByRole('button', { name: '晨间简报' }).click()
  await expect(brief).toBeVisible()
  await expect(brief.locator('.mock-kpi').filter({ hasText: '饮水缺口' })).toContainText('550 ml')

  await waitForPersistFlush(page)
  await page.reload()
  await expect(progress).toContainText('1.5')
  await page.getByRole('button', { name: '晨间简报' }).click()
  await expect(brief.locator('.mock-kpi').filter({ hasText: '饮水缺口' })).toContainText('550 ml')

  await waitForPersistFlush(page)
  await page.reload()
  // 第二次刷新若把数据重复写回就会变成 1.7 / 1.9，这里同时校验「不累加」。
  await expect(progress).toContainText('1.5')
  await expect(progress).not.toContainText('1.7')
})

test('刷新后保留长期计划与进行中状态', async ({ page }) => {
  await page.goto('/plans')
  await expect(page.getByRole('heading', { name: '把目标拆成每周能做到的事' })).toBeVisible()

  await page.locator('.plans-empty').getByRole('button', { name: '手工新建' }).click()
  const draft = page.getByRole('dialog', { name: '手工新建长期计划' })
  await draft.getByLabel('计划标题').fill('E2E 持久化计划')
  await page.getByRole('button', { name: '确认并启用' }).click()
  await expect(page.locator('.toast')).toContainText('已启用长期计划')
  await expect(page.locator('.plans-current')).toContainText('E2E 持久化计划')

  await waitForPersistFlush(page)
  await page.reload()

  const currentPanel = page.locator('.plans-current')
  await expect(currentPanel).toContainText('E2E 持久化计划')
  await expect(currentPanel.locator('.plans-status.is-active')).toHaveText('进行中')
})

test('刷新后保留设置里的提醒开关与时间', async ({ page }) => {
  await page.goto('/settings')
  const waterSwitch = page.getByLabel('启用饮水提醒')
  await expect(waterSwitch).toBeChecked()

  // 时间输入在提醒关闭后会被禁用，所以先改时间再关开关。
  await page.getByLabel('饮水提醒时间').fill('07:30')
  await waterSwitch.uncheck()
  await expect(waterSwitch).not.toBeChecked()

  await waitForPersistFlush(page)
  await page.reload()

  await expect(page.getByLabel('启用饮水提醒')).not.toBeChecked()
  await expect(page.getByLabel('饮水提醒时间')).toHaveValue('07:30')
})
