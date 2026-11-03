import { expect, test, type Page } from '@playwright/test'
import { createCompleteMockData } from '../src/data/complete-mock-data'
import type { ImportableMockData } from '../src/types'

async function mainNav(page: Page, label: '今日' | '健身' | '饮食' | '学习') {
  const mobile = (page.viewportSize()?.width ?? 1280) <= 900
  const nav = mobile ? page.locator('.bottom-nav') : page.locator('.side-nav')
  await nav.getByRole('link', { name: label, exact: true }).click()
}

function backupText(data: ImportableMockData) {
  return JSON.stringify({
    app: 'Persist',
    version: '0.1.0',
    mode: 'frontend-mock',
    exportedAt: new Date().toISOString(),
    data,
  })
}

test('freeform distance and duration workouts flow across fitness, today and reports', async ({
  page,
}) => {
  await page.goto('/fitness')
  await page.getByRole('button', { name: '记录运动', exact: true }).click()

  const recordDialog = page.getByRole('dialog', { name: '记录运动' })
  await expect(recordDialog).toBeVisible()
  await recordDialog.getByLabel('动作名称').fill('夜跑')
  await recordDialog.getByRole('button', { name: '距离', exact: true }).click()
  await recordDialog.getByLabel('距离 / km').fill('3.2')
  await recordDialog.getByLabel('运动时长 / min（可选）').fill('18')
  await recordDialog.getByRole('button', { name: '保存记录' }).click()

  await expect(page.getByText('已记录 3.2 km · 18 分钟 · 夜跑')).toBeVisible()
  const nightRun = page.locator('.fit-exercise').filter({ hasText: '夜跑' })
  await expect(nightRun).toContainText('距离')
  await expect(nightRun).toContainText('3.2 km')
  await expect(nightRun).toContainText('18 min')
  await expect(nightRun).not.toContainText('kg')

  await page.getByRole('button', { name: '添加动作', exact: true }).click()
  const library = page.getByRole('dialog', { name: '添加训练动作' })
  await expect(library).toBeVisible()
  await library.getByLabel('动作名称').fill('周末爬山')
  await library.getByRole('button', { name: '时长', exact: true }).click()
  await library.getByLabel('目标时长 / min').fill('40')
  await library.getByRole('button', { name: '加入今日动作' }).click()

  const hike = page.locator('.fit-exercise').filter({ hasText: '周末爬山' })
  await expect(hike).toContainText('40 min')
  await hike.getByRole('button', { name: /标记周末爬山第 1 组完成/ }).click()
  await expect(hike).toContainText('时长')
  await expect(hike).not.toContainText('kg')

  await mainNav(page, '今日')
  const fitnessEvent = page.locator('.event').filter({ hasText: '训练记录' })
  await expect(fitnessEvent).toContainText('运动 58 分钟')
  await expect(fitnessEvent).toContainText('距离 3.2 km')

  await mainNav(page, '学习')
  await page.getByRole('button', { name: '查看分析依据' }).click()
  await page.getByRole('button', { name: '前往 AI 报告' }).click()
  await expect(page).toHaveURL(/\/reports$/)
  await page.getByRole('button', { name: '查看分析依据' }).click()
  const evidence = page.locator('.reports-evidence')
  await expect(evidence).toContainText('累计运动 58 分钟')
  await expect(evidence).toContainText('距离 3.2 km')

  await page.setViewportSize({ width: 480, height: 900 })
  await mainNav(page, '健身')
  await expect(page.getByText('夜跑', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('周末爬山', { exact: true }).first()).toBeVisible()
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  )
  expect(overflow).toBeLessThanOrEqual(1)
})

test('legacy strength JSON imports while malformed workout JSON is rejected', async ({ page }) => {
  const data = createCompleteMockData()
  const legacyExercise = { ...data.fitnessSession!.exercises[0] }
  delete legacyExercise.kind
  data.fitnessSession = {
    ...data.fitnessSession!,
    exercises: [legacyExercise],
  }

  await page.goto('/settings')
  const fileInput = page.locator('input[type="file"]')
  await fileInput.setInputFiles({
    name: 'legacy-strength.json',
    mimeType: 'application/json',
    buffer: Buffer.from(backupText(data)),
  })
  await expect(page.getByText(/Mock 备份已导入/).first()).toBeVisible()

  await mainNav(page, '健身')
  await expect(page.getByText('杠铃平板卧推', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('60 kg', { exact: false }).first()).toBeVisible()

  const invalidData = createCompleteMockData()
  invalidData.fitnessSession!.exercises[0].sets[0].rpe = 11
  await page.goto('/settings')
  await fileInput.setInputFiles({
    name: 'invalid-workout.json',
    mimeType: 'application/json',
    buffer: Buffer.from(backupText(invalidData)),
  })
  await expect(page.getByRole('alert')).toContainText('训练会话格式不正确')
  await expect(
    page.getByText('导入失败：训练会话格式不正确，动作、套组或计时数据不完整'),
  ).toBeVisible()
})
