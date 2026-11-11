import { expect, test, type Page } from '@playwright/test'

async function mainNav(page: Page, label: '今日' | '健身' | '饮食' | '学习') {
  const mobile = (page.viewportSize()?.width ?? 1280) <= 900
  const nav = mobile ? page.locator('.bottom-nav') : page.locator('.side-nav')
  await nav.getByRole('link', { name: label, exact: true }).click()
}

async function openShellLink(page: Page, name: '打开个人档案' | '打开设置') {
  const mobile = (page.viewportSize()?.width ?? 1280) <= 900
  const shell = mobile ? page.locator('.mobile-bar') : page.locator('.sidebar')
  await shell.getByRole('link', { name }).click()
}

async function openReportsFromStudy(page: Page) {
  await mainNav(page, '学习')
  await page.getByRole('button', { name: '查看分析依据' }).click()
  await page.getByRole('button', { name: '前往 AI 报告' }).click()
  await expect(page).toHaveURL(/\/reports$/)
}

async function loadCompleteDemoData(page: Page) {
  await page.goto('/settings')
  await page.getByRole('button', { name: /加载完整演示数据/ }).click()
  await expect(page.getByText(/已加载完整演示数据/).first()).toBeVisible()
}

test('complete demo data populates every primary module', async ({ page }) => {
  await loadCompleteDemoData(page)

  const settingsStats = page.locator('.settings-hero-stats')
  await expect(settingsStats).toContainText('3 / 3')
  await expect(settingsStats).toContainText('4 / 4')
  await expect(page.getByLabel('允许 AI 使用的数据').locator('input:checked')).toHaveCount(4)

  await mainNav(page, '今日')
  await expect(page.locator('.countdowns')).toContainText('高数阶段测验')
  await expect(page.locator('.countdowns')).toContainText('英语六级考试')
  await expect(page.locator('.plan-panel .badge')).toHaveText('3 / 7')
  await expect(page.getByRole('region', { name: '今日进度' })).toContainText('2.0')
  await expect(page.getByText(/精力 4 \/ 5 · 专注度不错/)).toBeVisible()

  await mainNav(page, '健身')
  await expect(page.getByText('上肢力量 A', { exact: true }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: /取消杠铃平板卧推第 1 组完成/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /标记上斜哑铃卧推第 3 组完成/ })).toBeVisible()

  await mainNav(page, '饮食')
  await expect(page.getByText('4 / 4 餐已记录')).toBeVisible()
  await expect(page.locator('.metric').filter({ hasText: '饮水' })).toContainText('2.0')
  await expect(page.getByRole('heading', { name: '晚餐', exact: true })).toBeVisible()
  await expect(page.getByText('三文鱼糙米饭')).toBeVisible()

  await mainNav(page, '学习')
  await expect(page.getByText('今日记录 2 条')).toBeVisible()
  await expect(page.getByText('百词斩', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('高数错题复盘', { exact: true }).first()).toBeVisible()

  await openShellLink(page, '打开个人档案')
  await expect(page.locator('.profile-completion')).toContainText('100%')
  await expect(page.getByText('花生过敏', { exact: true })).toBeVisible()
  await expect(page.getByText('23:15', { exact: true })).toBeVisible()
  await expect(page.getByText('中等', { exact: true })).toBeVisible()

  await page.goBack()
  await openReportsFromStudy(page)
  await expect(page.locator('.reports-history-count')).toHaveText('5 份')
  await expect(page.locator('.reports-history-list')).toContainText('训练建议')
  await expect(page.locator('.reports-history-list')).toContainText('学习观察')
  await expect(page.locator('.reports-history-list')).toContainText('饮食观察')
})

test('complete demo data feeds reports and respects AI source toggles', async ({ page }) => {
  await loadCompleteDemoData(page)
  await openReportsFromStudy(page)
  await page.getByRole('button', { name: '查看分析依据' }).click()

  const evidence = page.locator('.reports-evidence')
  await expect(evidence).toContainText(
    '训练记录：近 7 天 6 个动作，完成 10 组，力量容量 2,680 kg，累计运动 37 分钟，距离 8.5 km',
  )
  await expect(evidence).toContainText(
    '学习记录：近 7 天共 12 条，英语 6 条、高数 6 条，累计 446 分钟',
  )
  await expect(evidence).toContainText('饮水记录：近 7 天累计 0.80 L（3 次记录，日均 0.11 L）')
  await expect(evidence).toContainText('个人档案：已填写 14 / 14 项，完整度 100%')

  await openShellLink(page, '打开设置')
  await page.getByRole('checkbox', { name: /^学习记录/ }).uncheck()
  await page.getByRole('checkbox', { name: /^训练记录/ }).uncheck()

  await page.goBack()
  await expect(page).toHaveURL(/\/reports$/)
  await page.getByRole('button', { name: '查看分析依据' }).click()
  await expect(page.getByText('学习记录：本次不引用')).toBeVisible()
  await expect(page.getByText('训练记录：本次不引用')).toBeVisible()
})

test('complete demo data supports report generation and applying suggestions to today', async ({
  page,
}) => {
  await loadCompleteDemoData(page)
  await openReportsFromStudy(page)

  await page.getByRole('button', { name: '生成今日简报', exact: true }).click()
  await expect(page.getByText('今日简报已生成')).toBeVisible()
  await expect(page.locator('.reports-history-count')).toHaveText('6 份')

  await page.getByRole('button', { name: '查看简报', exact: true }).click()
  const generated = page.getByRole('dialog', { name: /训练已经落地|先把训练安排好/ })
  await expect(generated).toBeVisible()
  await generated.locator('.surface-form-actions').getByRole('button', { name: '关闭' }).click()

  const trainingReportRow = page
    .locator('.reports-history-row')
    .filter({ hasText: '训练建议' })
    .first()
  await trainingReportRow.click()
  const trainingReport = page.getByRole('dialog')
  await expect(trainingReport).toBeVisible()
  await trainingReport.getByRole('button', { name: '应用建议' }).click()
  await page.getByRole('button', { name: '应用并查看今日' }).click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.locator('.plan-panel .plan-item')).toHaveCount(10)
  await expect(page.locator('.plan-panel')).toContainText('近 7 天训练记录 · 查看报告后加入')
})
