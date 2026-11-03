import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'

test('today page renders and primary navigation works', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: /今天，先稳住/ })).toBeVisible()
  await expect(page.getByRole('region', { name: '今日进度' })).toBeVisible()
  await expect(page.getByRole('region', { name: '两个重要目标倒计时' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '今日安排' })).toBeVisible()

  const viewport = page.viewportSize()
  const mobile = (viewport?.width ?? 1_280) <= 900
  const nav = mobile ? page.locator('.bottom-nav') : page.locator('.side-nav')
  await nav.getByRole('link', { name: '健身' }).click()

  await expect(page).toHaveURL(/\/fitness$/)
  await expect(page.getByRole('heading', { name: /训练，留下/ })).toBeVisible()
})

test('AI report is reachable from today and primary navigation', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'AI 报告', exact: true }).click()
  await expect(page).toHaveURL(/\/reports$/)
  await expect(page.getByRole('heading', { name: /把记录/ })).toBeVisible()

  await page.goto('/')
  const viewport = page.viewportSize()
  const mobile = (viewport?.width ?? 1_280) <= 900
  const nav = mobile ? page.locator('.bottom-nav') : page.locator('.side-nav')
  await nav.getByRole('link', { name: 'AI 报告', exact: true }).click()
  await expect(page).toHaveURL(/\/reports$/)
  await expect(nav.getByRole('link', { name: 'AI 报告', exact: true })).toHaveClass(/active/)
})

test('quick record adds water and updates the daily metric', async ({ page }) => {
  await page.goto('/')

  await page.getByRole('button', { name: '快速记录', exact: true }).first().click()
  await expect(page.getByRole('dialog', { name: '记录什么？' })).toBeVisible()
  await page.getByRole('button', { name: '饮水', exact: true }).click()

  await expect(page.getByText('已记录 250 ml 饮水')).toBeVisible()
  await expect(page.getByRole('region', { name: '今日进度' })).toContainText('1.5')
})

test('important goal can be edited and persisted in the mock session', async ({ page }) => {
  await page.goto('/')

  await page
    .getByRole('button', { name: /编辑重要目标/ })
    .first()
    .click()
  await expect(page.getByRole('dialog', { name: /编辑重要目标 01/ })).toBeVisible()
  await page.getByLabel('目标名称').fill('新的阶段目标')
  await page.getByRole('button', { name: '保存目标' }).click()

  await expect(page.getByRole('button', { name: '编辑重要目标：新的阶段目标' })).toBeVisible()
  await expect(page.getByText('重要目标已更新')).toBeVisible()
})

test('mobile layout does not overflow horizontally', async ({ page }) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  )
  expect(overflow).toBeLessThanOrEqual(1)
})

test('fitness set tracking, recording, exercise library and completion work', async ({ page }) => {
  await page.goto('/fitness')

  await expect(page.getByRole('heading', { name: /训练，留下/ })).toBeVisible()
  await expect(page.getByRole('region', { name: '今日训练进度' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '今日动作' })).toBeVisible()

  const firstSet = page.getByRole('button', { name: /取消杠铃平板卧推第 1 组完成/ })
  await firstSet.click()
  await expect(page.getByRole('button', { name: /标记杠铃平板卧推第 1 组完成/ })).toBeVisible()
  await expect(page.getByText('2 / 14', { exact: true }).first()).toBeVisible()

  await page.getByRole('button', { name: '记录运动', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '记录运动' })).toBeVisible()
  await page.getByLabel('重量 / kg').fill('62.5')
  await page.getByLabel('次数').fill('8')
  await page.getByRole('button', { name: '保存记录' }).click()
  await expect(page.getByText('已记录 62.5 kg × 8 次')).toBeVisible()

  await page.getByRole('button', { name: '添加动作', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '添加训练动作' })).toBeVisible()
  await page.getByRole('button', { name: /绳索夹胸/ }).click()
  await expect(page.getByText('已添加 绳索夹胸')).toBeVisible()

  await page.getByRole('button', { name: '完成训练', exact: true }).click()
  await expect(page.getByText('今日训练已完成')).toBeVisible()
  await expect(page.getByRole('button', { name: '训练已完成' })).toBeDisabled()
})

test('fitness page does not overflow horizontally on mobile', async ({ page }) => {
  await page.goto('/fitness')
  await page.waitForLoadState('networkidle')

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  )
  expect(overflow).toBeLessThanOrEqual(1)
})

test('diet page renders meals, water, nutrition and AI observation', async ({ page }) => {
  await page.goto('/diet')

  await expect(page.getByRole('heading', { name: /吃得清楚/ })).toBeVisible()
  await expect(page.getByRole('region', { name: '今日营养进度' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '今日餐次' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '饮水记录' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '营养结构' })).toBeVisible()
  await expect(page.getByText('燕麦酸奶碗', { exact: true })).toBeVisible()
})

test('diet meal editor adds a food entry', async ({ page }) => {
  await page.goto('/diet')

  await page.getByRole('button', { name: '编辑早餐' }).click()
  await expect(page.getByRole('dialog', { name: '编辑早餐' })).toBeVisible()
  await page.getByLabel('食物名称').fill('蓝莓')
  await page.getByLabel('份量').fill('1 小碗 · 100 g')
  await page.getByLabel('热量 / kcal').fill('57')
  await page.getByLabel('蛋白质 / g').fill('0.7')
  await page.getByLabel('碳水 / g').fill('14')
  await page.getByLabel('脂肪 / g').fill('0.3')
  await page.getByRole('button', { name: '添加到早餐' }).click()

  await expect(page.getByText('已将 蓝莓 添加到早餐')).toBeVisible()
  await expect(page.locator('.diet-entry-copy strong').filter({ hasText: '蓝莓' })).toBeVisible()
})

test('external AI nutrition text is parsed and registered after review', async ({ page }) => {
  await page.goto('/diet')

  await page.getByRole('button', { name: 'AI 热量登记' }).click()
  await expect(page.getByRole('dialog', { name: 'AI 热量登记' })).toBeVisible()
  await page
    .getByLabel('AI 识别结果')
    .fill('清蒸鲈鱼\n热量 320 kcal，蛋白质 38 g，碳水 4 g，脂肪 16 g')
  await page.getByRole('button', { name: '解析营养信息' }).click()

  await expect(page.getByLabel('食物名称')).toHaveValue('清蒸鲈鱼')
  await expect(page.getByLabel('热量 / kcal')).toHaveValue('320')
  await page.getByRole('button', { name: '确认登记' }).click()

  await expect(page.getByText('已核对并登记 清蒸鲈鱼')).toBeVisible()
  await expect(
    page.locator('.diet-entry-copy strong').filter({ hasText: '清蒸鲈鱼' }),
  ).toBeVisible()
})

test('diet water shortcuts, custom amount and undo update progress', async ({ page }) => {
  await page.goto('/diet')

  const waterProgress = page.getByRole('progressbar', { name: '今日饮水进度' })
  const waterValue = page.locator('.diet-water-copy strong')
  await expect(waterProgress).toHaveAttribute('aria-valuenow', '60')

  await page.getByRole('button', { name: '+ 125 ml' }).click()
  await page.getByRole('button', { name: '+ 250 ml' }).click()
  await expect(waterValue).toContainText('1.58')

  await page.getByLabel('自定义饮水量').fill('300')
  await page.locator('.diet-water-custom').getByRole('button', { name: '记录' }).click()
  await expect(waterValue).toContainText('1.88')

  await page.getByRole('button', { name: '撤销上一条饮水' }).click()
  await expect(waterValue).toContainText('1.58')
})

test('diet page does not overflow horizontally on mobile', async ({ page }) => {
  await page.goto('/diet')
  await page.waitForLoadState('networkidle')

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  )
  expect(overflow).toBeLessThanOrEqual(1)
})
test('today plan can be added and removed through the editor', async ({ page }) => {
  await page.goto('/')

  await page.locator('.plan-foot').getByRole('button', { name: '添加一项安排' }).click()
  await expect(page.getByRole('dialog', { name: '编辑今日安排' })).toBeVisible()
  await page.locator('.mock-add-row').click()

  const newRow = page.locator('.mock-planner-row').last()
  await newRow.getByLabel('安排名称').fill('晚间拉伸')
  await newRow.getByLabel('时间').fill('21:20')
  await newRow.getByLabel('详情').fill('10 分钟 · 髋部与肩部放松')
  await page.getByRole('button', { name: '保存计划' }).click()

  await expect(page.getByText('今日计划已更新')).toBeVisible()
  await expect(page.locator('.plan-panel .plan-name').filter({ hasText: '晚间拉伸' })).toBeVisible()

  await page.locator('.plan-panel .panel-head').getByRole('button', { name: '调整' }).click()
  const addedRow = page.locator('.mock-planner-row').filter({ hasText: '晚间拉伸' })
  await addedRow.getByRole('button', { name: '删除晚间拉伸' }).click()
  await page.getByRole('button', { name: '保存计划' }).click()

  await expect(page.locator('.plan-panel .plan-name').filter({ hasText: '晚间拉伸' })).toHaveCount(0)
})

test('today timeline, morning brief and evening review open and save', async ({ page }) => {
  await page.goto('/')

  await page.getByRole('button', { name: '查看全部' }).click()
  await expect(page.getByRole('dialog', { name: '今日完整时间线' })).toBeVisible()
  await expect(page.getByText('时间线只用于回看', { exact: false })).toBeVisible()
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: '晨间简报' }).click()
  await expect(page.getByRole('dialog', { name: '晨间简报' })).toBeVisible()
  await expect(page.getByText('今天的建议节奏')).toBeVisible()
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: '结束今日' }).click()
  await expect(page.getByRole('dialog', { name: '结束今日' })).toBeVisible()
  await page.getByRole('button', { name: '4', exact: true }).click()
  await page.getByLabel('整体状态').selectOption({ label: '专注度不错' })
  await page.getByLabel('今日备注').fill('完成了训练，晚上整理明日计划。')
  await page.getByRole('button', { name: '保存复盘' }).click()

  await expect(page.getByText('已保存今日复盘 · 精力 4/5')).toBeVisible()
  await expect(page.getByText('今天的复盘已经记录。')).toBeVisible()
})

test('quick record URLs open the matching mock forms', async ({ page }) => {
  await page.goto('/fitness?new=1')
  await expect(page.getByRole('dialog', { name: '记录运动' })).toBeVisible()

  await page.goto('/diet?new=1')
  await expect(page.getByRole('dialog', { name: 'AI 热量登记' })).toBeVisible()
})

test('fitness template, evidence and history details are interactive', async ({ page }) => {
  await page.goto('/fitness')

  await page.locator('.fit-template-row').filter({ hasText: '下肢力量 B' }).click()
  await expect(page.getByText('已切换到 下肢力量 B，当前训练已重置')).toBeVisible()
  await expect(page.locator('.progress .count-note')).toContainText('下肢力量 B')

  await page.getByRole('button', { name: '查看依据' }).click()
  await expect(page.getByRole('dialog', { name: '训练分析依据' })).toBeVisible()
  await expect(page.getByText('历史记录对照')).toBeVisible()
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: '查看全部' }).click()
  await expect(page.getByRole('dialog', { name: '训练历史' })).toBeVisible()
  await page.locator('.full-history-row').first().click()
  await expect(page.getByText('动作与组数')).toBeVisible()
  await expect(page.getByText('历史 Mock 记录', { exact: false })).toBeVisible()
})

test('diet evidence sheet reflects recorded nutrition and water', async ({ page }) => {
  await page.goto('/diet')

  await page.getByRole('button', { name: '查看分析依据' }).click()
  const dialog = page.getByRole('dialog', { name: '饮食分析依据' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('热量与宏量营养')).toBeVisible()
  await expect(dialog.getByText('照片附件')).toBeVisible()
  await expect(dialog.getByText('饮水记录', { exact: true })).toBeVisible()
})

test('profile can export a JSON copy', async ({ page }) => {
  await page.goto('/profile')

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出档案副本' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('persist-profile.json')

  const downloadPath = await download.path()
  expect(downloadPath).not.toBeNull()
  const payload = JSON.parse(await readFile(downloadPath as string, 'utf8')) as {
    app: string
    version: string
    profile: { goal: string; aiConsent: boolean }
  }
  expect(payload.app).toBe('Persist')
  expect(payload.version).toBe('0.1.0')
  expect(payload.profile.goal).toBe('增肌同时改善体态')
  expect(payload.profile.aiConsent).toBe(true)
  await expect(page.getByText('个人档案副本已导出')).toBeVisible()
})

test('settings privacy and self-hosting guidance open as sheets', async ({ page }) => {
  await page.goto('/settings')

  await page.getByRole('button', { name: '查看数据使用说明' }).click()
  await expect(page.getByRole('dialog', { name: '数据使用说明' })).toBeVisible()
  await expect(page.getByText('API Key 只保存在服务端')).toBeVisible()
  await page.getByRole('button', { name: '我知道了' }).click()

  await page.getByRole('button', { name: '自托管部署说明' }).click()
  await expect(page.getByRole('dialog', { name: '自托管部署说明' })).toBeVisible()
  await expect(page.getByText('DEEPSEEK_API_KEY', { exact: false })).toBeVisible()
  await expect(page.getByText('限制请求来源')).toBeVisible()
  await page.getByRole('button', { name: '返回设置' }).click()
})

test('report type cards open the matching reports', async ({ page }) => {
  await page.goto('/reports')

  const typeList = page.locator('.reports-type-list')
  await typeList.getByRole('button', { name: /训练建议/ }).click()
  await expect(page.getByRole('dialog', { name: /下肢训练后恢复窗口偏短/ })).toBeVisible()
  await page.keyboard.press('Escape')

  await typeList.getByRole('button', { name: /学习观察/ }).click()
  await expect(page.getByRole('dialog', { name: /英语记录更连续/ })).toBeVisible()
  await expect(page.getByText('英语投入', { exact: true })).toBeVisible()
})

test('applying a report updates today plan and navigates home', async ({ page }) => {
  await page.goto('/reports')

  await page.locator('.reports-brief').getByRole('button', { name: '应用建议' }).click()
  await expect(page.getByRole('alertdialog', { name: '把这些建议应用到今日计划？' })).toBeVisible()
  await page.getByRole('button', { name: '应用并查看今日' }).click()

  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByText('已应用「每周复盘」建议')).toBeVisible()
  const mathPlan = page.locator('.plan-item').filter({ hasText: '高数：极限与连续' })
  await expect(mathPlan).toContainText('18:10')
  await expect(mathPlan).toContainText('晚饭前练习 12 题')
})
