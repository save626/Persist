import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'

type MockBackup = {
  data: {
    studyRecords: Array<Record<string, unknown>>
  }
}

async function mainNav(page: Page, label: '今日' | '健身' | '饮食' | '学习') {
  const mobile = (page.viewportSize()?.width ?? 1280) <= 900
  const nav = mobile ? page.locator('.bottom-nav') : page.locator('.side-nav')
  await nav.getByRole('link', { name: label, exact: true }).click()
}

async function openSettings(page: Page) {
  await page.locator('a[aria-label="打开设置"]:visible').click()
  await expect(page).toHaveURL(/\/settings$/)
}

async function openPlansFromToday(page: Page) {
  await mainNav(page, '今日')
  await page.getByRole('button', { name: '长期计划', exact: true }).click()
  await expect(page).toHaveURL(/\/plans$/)
}

function localDateValue() {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

test('generated daily brief enters history and applies its plan suggestion', async ({ page }) => {
  await page.goto('/reports')

  await expect(page.locator('.reports-history-count')).toHaveText('4 份')
  await page.getByRole('button', { name: '生成今日简报', exact: true }).click()
  await expect(page.getByText('今日简报已生成')).toBeVisible()
  await expect(page.locator('.reports-history-count')).toHaveText('5 份')

  await page.getByRole('button', { name: '查看简报', exact: true }).click()
  const detail = page.getByRole('dialog', { name: '先把训练安排好，再收住晚间学习' })
  await expect(detail).toBeVisible()
  await detail.getByRole('button', { name: '应用建议' }).click()

  await expect(page.getByRole('alertdialog', { name: '把这些建议应用到今日计划？' })).toBeVisible()
  await page.getByRole('button', { name: '应用并查看今日' }).click()

  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByText('已应用「今日简报」建议')).toBeVisible()
  const hydrationPlan = page.locator('.plan-item').filter({ hasText: '下午分两次补水' })
  await expect(hydrationPlan).toContainText('15:30')
  await expect(hydrationPlan).toContainText('每次 250 ml')
})

test('report range selector updates the displayed period', async ({ page }) => {
  await page.goto('/reports')

  const range = page.getByLabel('报告时间范围')
  await expect(page.locator('.reports-kicker')).toContainText('近 7 天')

  await range.getByRole('button', { name: '近 30 天', exact: true }).click()
  await expect(page.locator('.reports-kicker')).toContainText('近 30 天')

  await range.getByRole('button', { name: '近 90 天', exact: true }).click()
  await expect(page.locator('.reports-kicker')).toContainText('近 90 天')
})

test('morning brief reflects newly recorded water in its KPIs', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '晨间简报' }).click()

  let dialog = page.getByRole('dialog', { name: '晨间简报' })
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('.mock-kpi').filter({ hasText: '今日记录' })).toContainText('6 条')
  await expect(dialog.locator('.mock-kpi').filter({ hasText: '饮水缺口' })).toContainText('800 ml')
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: '快速记录', exact: true }).first().click()
  await page.getByRole('button', { name: '饮水', exact: true }).click()
  await expect(page.getByText('已记录 250 ml 饮水')).toBeVisible()

  await page.getByRole('button', { name: '晨间简报' }).click()
  dialog = page.getByRole('dialog', { name: '晨间简报' })
  await expect(dialog.locator('.mock-kpi').filter({ hasText: '今日记录' })).toContainText('7 条')
  await expect(dialog.locator('.mock-kpi').filter({ hasText: '饮水缺口' })).toContainText('550 ml')
  await expect(dialog.getByText('下午：补水 550 ml')).toBeVisible()
})

test('snapshot shows a generated time and current record count', async ({ page }) => {
  await page.goto('/settings')

  const snapshotRow = page.locator('.settings-backup-row')
  await expect(snapshotRow).toContainText('尚未生成快照')
  await page.getByRole('button', { name: '立即生成快照' }).click()

  await expect(page.getByText(/Mock 快照已生成 · \d+ 条记录/)).toBeVisible()
  await expect(snapshotRow).not.toContainText('尚未生成快照')
  await expect(snapshotRow).toContainText(/\d+ 条记录/)
})

test('valid JSON backup replaces mock data and updates the study page', async ({ page }) => {
  await page.goto('/settings')

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: /导出 JSON 备份/ }).click()
  const download = await downloadPromise
  const downloadPath = await download.path()
  expect(downloadPath).not.toBeNull()

  const backup = JSON.parse(await readFile(downloadPath as string, 'utf8')) as MockBackup
  backup.data.studyRecords.push({
    ...backup.data.studyRecords[0],
    id: 'study-json-import',
    source: 'JSON 导入验证',
    date: localDateValue(),
    startTime: '18:45',
    duration: 33,
  })

  await page.locator('.settings-file-input').setInputFiles({
    name: 'persist-backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup)),
  })

  await expect(page.getByText(/Mock 备份已导入 · \d+ 条记录（含 0 个长期计划）/)).toBeVisible()
  await mainNav(page, '学习')
  const importedJsonRow = page.locator('.study-timeline-row').filter({ hasText: 'JSON 导入验证' })
  await expect(importedJsonRow).toBeVisible()
  await expect(importedJsonRow).toContainText('33 min')
})

test('JSON backup keeps long-term plans across export and re-import', async ({ page }) => {
  // Mock 数据只存在内存里，所以跨页全程用站内链接跳转；page.goto 会整页刷新并清空状态。
  await page.goto('/plans')
  await page.locator('.plans-empty').getByRole('button', { name: '手工新建' }).click()
  const draft = page.getByRole('dialog', { name: '手工新建长期计划' })
  await draft.getByLabel('计划标题').fill('E2E 备份保留计划')
  await page.getByRole('button', { name: '确认并启用' }).click()
  await expect(page.locator('.toast')).toContainText('已启用长期计划')

  await openSettings(page)
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: /导出 JSON 备份/ }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/^persist-mock-backup-\d{4}-\d{2}-\d{2}\.json$/)
  await expect(page.getByText('Mock 数据备份已导出 · 含 1 个长期计划')).toBeVisible()

  const downloadPath = await download.path()
  expect(downloadPath).not.toBeNull()
  const backup = JSON.parse(await readFile(downloadPath as string, 'utf8')) as {
    version: string
    data: { longTermPlans: Array<{ title: string }> }
  }
  expect(backup.version).toBe('0.2.0')
  expect(backup.data.longTermPlans).toHaveLength(1)
  expect(backup.data.longTermPlans[0].title).toBe('E2E 备份保留计划')

  // 刷新会清空内存里的计划；导入刚导出的 0.2.0 备份应把它恢复。
  await page.reload()
  await page.locator('.settings-file-input').setInputFiles({
    name: 'persist-backup-020.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup)),
  })
  await expect(page.getByText(/Mock 备份已导入 · \d+ 条记录（含 1 个长期计划）/)).toBeVisible()

  await openPlansFromToday(page)
  await expect(page.locator('.plans-current')).toContainText('E2E 备份保留计划')

  // 0.1.0 旧备份没有 longTermPlans 字段，仍应能导入并按零个计划处理。
  await openSettings(page)
  const legacy = JSON.parse(JSON.stringify(backup)) as {
    version: string
    data: { longTermPlans?: unknown }
  }
  legacy.version = '0.1.0'
  delete legacy.data.longTermPlans

  await page.locator('.settings-file-input').setInputFiles({
    name: 'persist-backup-010.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(legacy)),
  })
  await expect(page.getByText(/Mock 备份已导入 · \d+ 条记录（含 0 个长期计划）/)).toBeVisible()

  await openPlansFromToday(page)
  await expect(page.locator('.plans-empty')).toBeVisible()
})

test('CSV import appends a study record visible on the study page', async ({ page }) => {
  await page.goto('/settings')
  const csv = [
    '日期,类型,学习来源,开始时间,学习时长,备注',
    `${localDateValue()},英语,CSV 导入验证,19:10,35,端到端 Mock 验证`,
  ].join('\n')

  await page.locator('.settings-file-input').setInputFiles({
    name: 'study-records.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv, 'utf8'),
  })

  await expect(page.getByText('CSV 导入成功 · 已追加 1 条学习记录')).toBeVisible()
  await mainNav(page, '学习')
  const importedCsvRow = page.locator('.study-timeline-row').filter({ hasText: 'CSV 导入验证' })
  await expect(importedCsvRow).toBeVisible()
  await expect(importedCsvRow).toContainText('35 min')
})

test('invalid import reports an error without changing study data', async ({ page }) => {
  await page.goto('/settings')

  await page.locator('.settings-file-input').setInputFiles({
    name: 'unsupported.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from('not a real spreadsheet'),
  })

  await expect(page.getByRole('alert')).toHaveText(
    'Excel 暂不支持直接解析，请在 Excel 中另存为 UTF-8 CSV 后再导入',
  )
  await expect(page.getByText(/导入失败：Excel 暂不支持直接解析/)).toBeVisible()

  await mainNav(page, '学习')
  await expect(page.getByText('今日记录 2 条')).toBeVisible()
})
