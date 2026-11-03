import { expect, test, type Page } from '@playwright/test'

const ONBOARD_INPUT = '我今年 28 岁，身高 175，体重 80 公斤，想减脂，每周练 4 次，帮我生成计划'

async function openPlans(page: Page) {
  await page.goto('/plans')
  await expect(page.getByRole('heading', { name: '把目标拆成每周能做到的事' })).toBeVisible()
}

test('档案页的 AI 建档入口带 onboard 参数进入长期计划页', async ({ page }) => {
  await page.goto('/profile')
  await page.getByRole('button', { name: 'AI 建档' }).click()
  await expect(page).toHaveURL(/\/plans\?onboard=1$/)
  await expect(page.getByRole('dialog', { name: 'AI 建档对话' })).toBeVisible()
})

test('AI 建档对话确认后启用长期计划并写回档案', async ({ page }) => {
  await page.goto('/plans?onboard=1')

  const chat = page.getByRole('dialog', { name: 'AI 建档对话' })
  await expect(chat).toBeVisible()

  await page.getByLabel('对话输入').fill(ONBOARD_INPUT)
  await page.getByRole('button', { name: '发送', exact: true }).click()

  await expect(page.getByRole('button', { name: '去确认草案' })).toBeVisible()
  await page.getByRole('button', { name: '去确认草案' }).click()

  const draft = page.getByRole('dialog', { name: '确认长期计划草案' })
  await expect(draft).toBeVisible()
  await expect(draft.getByLabel('计划标题')).not.toHaveValue('')

  await page.getByRole('button', { name: '确认并启用' }).click()

  await expect(page.locator('.toast')).toContainText('已启用长期计划')
  await expect(chat).toHaveCount(0)
  await expect(page.locator('.plans-current .plans-status.is-active')).toHaveText('进行中')
  await expect(page).toHaveURL(/\/plans$/)
})

test('手工新建计划后归档并重新启用', async ({ page }) => {
  await openPlans(page)

  await page.locator('.plans-empty').getByRole('button', { name: '手工新建' }).click()
  const draft = page.getByRole('dialog', { name: '手工新建长期计划' })
  await expect(draft).toBeVisible()

  await draft.getByLabel('计划标题').fill('E2E 十二周力量计划')
  await page.getByRole('button', { name: '确认并启用' }).click()

  await expect(page.locator('.toast')).toContainText('已启用长期计划')
  const currentPanel = page.locator('.plans-current')
  await expect(currentPanel).toContainText('E2E 十二周力量计划')
  await expect(currentPanel.locator('.plans-status.is-active')).toHaveText('进行中')

  await currentPanel.getByRole('button', { name: '归档计划' }).click()
  const archiveDialog = page.getByRole('alertdialog', { name: '归档这份计划？' })
  await expect(archiveDialog).toBeVisible()
  await archiveDialog.getByRole('button', { name: '归档' }).click()

  await expect(page.locator('.toast')).toContainText('已归档')
  await expect(page.locator('.plans-empty')).toBeVisible()
  const archivedRow = page
    .locator('.plans-side-column .plans-row')
    .filter({ hasText: 'E2E 十二周力量计划' })
  await expect(archivedRow.locator('.plans-status.is-archived')).toHaveText('已归档')

  await archivedRow.getByRole('button', { name: '重新启用' }).click()
  await expect(page.locator('.toast')).toContainText('已启用「E2E 十二周力量计划」')
  await expect(page.locator('.plans-current .plans-status.is-active')).toHaveText('进行中')
  await expect(archivedRow).toHaveCount(0)
})

test('长期计划页在窄屏没有横向溢出', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 })
  await openPlans(page)

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  )
  expect(overflow).toBeLessThanOrEqual(1)

  await page.locator('.plans-head-actions').getByRole('button', { name: 'AI 建档' }).click()
  await expect(page.getByRole('dialog', { name: 'AI 建档对话' })).toBeVisible()
  const chatOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  )
  expect(chatOverflow).toBeLessThanOrEqual(1)
})
