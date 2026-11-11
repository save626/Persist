import { expect, test, type Page } from '@playwright/test'
import { chooseTime } from './date-time'

async function mainNav(page: Page, label: '今日' | '健身' | '饮食' | '学习') {
  const mobile = (page.viewportSize()?.width ?? 1280) <= 900
  const nav = mobile ? page.locator('.bottom-nav') : page.locator('.side-nav')
  await nav.getByRole('link', { name: label, exact: true }).click()
}

async function openProfile(page: Page) {
  await page.getByRole('link', { name: '打开个人档案' }).click()
  await expect(page).toHaveURL(/\/profile$/)
}

async function openSettings(page: Page) {
  await page.getByRole('link', { name: '打开设置' }).click()
  await expect(page).toHaveURL(/\/settings$/)
}

function aiSource(page: Page, label: '学习记录' | '训练记录') {
  return page.getByRole('checkbox', { name: new RegExp('^' + label) })
}

async function openReportsFromStudy(page: Page) {
  await mainNav(page, '学习')
  await page.getByRole('button', { name: '查看分析依据' }).click()
  await page.getByRole('button', { name: '前往 AI 报告' }).click()
  await expect(page).toHaveURL(/\/reports$/)
}

test('new study record survives navigation and updates today', async ({ page }) => {
  await page.goto('/study')
  await page.getByRole('button', { name: '新增记录' }).click()

  const dialog = page.getByRole('dialog', { name: '新增学习记录' })
  await expect(dialog).toBeVisible()
  const source = dialog.getByLabel('学习来源')
  await source.selectOption('__custom__')
  await source.fill('Mock 英语专项')
  await page.getByLabel('学习时长 / min').fill('25')
  await chooseTime(page, '开始时间', '17:20')
  await page.getByRole('button', { name: '添加记录' }).click()

  await expect(page.getByText('学习记录已添加')).toBeVisible()
  await expect(page.getByText('今日记录 3 条')).toBeVisible()
  await expect(page.getByRole('region', { name: '今日学习概览' })).toContainText('80')

  await mainNav(page, '今日')
  const studyMetric = page
    .getByRole('region', { name: '今日进度' })
    .locator('.metric')
    .filter({ hasText: '学习' })
  await expect(studyMetric).toContainText('80')
  await expect(page.getByText('今天已经留下 7 条记录')).toBeVisible()

  await mainNav(page, '学习')
  await expect(page.getByText('Mock 英语专项', { exact: true })).toBeVisible()
  await expect(page.getByText('25 min', { exact: true })).toBeVisible()
})

test('switching study category clears the subject-specific source', async ({ page }) => {
  await page.goto('/study')
  await page.getByRole('button', { name: '新增记录' }).click()

  const dialog = page.getByRole('dialog', { name: '新增学习记录' })
  const source = dialog.getByLabel('学习来源')

  await expect(source.locator('option')).toHaveText([
    '请选择学习来源',
    '百词斩',
    '不背单词',
    '英语真题',
    '听力精练',
    '自定义来源…',
  ])

  const newWords = dialog.getByLabel('新学单词')
  await expect(newWords).toHaveValue('')
  await newWords.fill('12')
  await expect(newWords).toHaveValue('12')
  await newWords.fill('')
  await expect(newWords).toHaveValue('')

  await source.selectOption('百词斩')
  await dialog.getByRole('button', { name: /高数/ }).click()
  // 换科后旧来源不能留在选择框里，候选列表要同步换成该科的。
  await expect(source).toHaveValue('')
  await expect(source.locator('option')).toHaveText([
    '请选择学习来源',
    '高数练习',
    '错题整理',
    '课程学习',
    '自定义来源…',
  ])

  const questions = dialog.getByLabel('练习题量')
  const wrong = dialog.getByLabel('错题数')
  await expect(questions).toHaveValue('')
  await expect(wrong).toHaveValue('')
  await questions.fill('20')
  await questions.fill('')
  await wrong.fill('3')
  await wrong.fill('')
  await expect(questions).toHaveValue('')
  await expect(wrong).toHaveValue('')

  await source.selectOption('高数练习')
  await dialog.getByRole('button', { name: /英语/ }).click()
  await expect(source).toHaveValue('')
  await expect(source.locator('option')).toHaveText([
    '请选择学习来源',
    '百词斩',
    '不背单词',
    '英语真题',
    '听力精练',
    '自定义来源…',
  ])
})

test('meal food survives navigation and updates the daily calorie total', async ({ page }) => {
  await page.goto('/diet')
  await page.getByRole('button', { name: '编辑早餐' }).click()

  const dialog = page.getByRole('dialog', { name: '编辑早餐' })
  await expect(dialog).toBeVisible()
  await page.getByLabel('食物名称').fill('蓝莓')
  await page.getByLabel('份量').fill('80 g')
  await page.getByLabel('热量 / kcal').fill('57')
  await page.getByLabel('蛋白质 / g').fill('0.6')
  await page.getByLabel('碳水 / g').fill('12')
  await page.getByLabel('脂肪 / g').fill('0.2')
  await page.getByRole('button', { name: '添加到早餐' }).click()
  await expect(dialog.getByText('蓝莓', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '关闭餐次编辑' }).click()

  await expect(page.getByRole('region', { name: '今日营养进度' })).toContainText('1,237')
  await mainNav(page, '今日')
  const dietMetric = page
    .getByRole('region', { name: '今日进度' })
    .locator('.metric')
    .filter({ hasText: '饮食摄入' })
  await expect(dietMetric).toContainText('1,237')

  await mainNav(page, '饮食')
  await expect(page.getByText('蓝莓', { exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: '今日营养进度' })).toContainText('1,237')
})

test('fitness set, exercise and completion survive navigation', async ({ page }) => {
  await page.goto('/fitness')
  await page.getByRole('button', { name: /取消杠铃平板卧推第 1 组完成/ }).click()
  await page.getByRole('button', { name: '添加动作', exact: true }).click()

  const library = page.getByRole('dialog', { name: '添加训练动作' })
  await expect(library).toBeVisible()
  await library.getByRole('button', { name: /绳索夹胸/ }).click()
  await expect(page.getByText('已添加 绳索夹胸')).toBeVisible()

  await page.getByRole('button', { name: '完成训练', exact: true }).click()
  await expect(page.getByText('今日训练已完成')).toBeVisible()

  await mainNav(page, '今日')
  const planMetric = page
    .getByRole('region', { name: '今日进度' })
    .locator('.metric')
    .filter({ hasText: '计划完成' })
  await expect(planMetric).toContainText('4 / 5')
  await expect(page.locator('.plan-item').filter({ hasText: '上肢力量训练' })).toHaveClass(/done/)

  await mainNav(page, '健身')
  await expect(page.getByText('今日训练已完成')).toBeVisible()
  await expect(page.getByRole('button', { name: '训练已完成' })).toBeDisabled()
  await expect(page.getByText('绳索夹胸', { exact: true })).toBeVisible()
})

test('profile edits survive navigation and persist in the mock session', async ({ page }) => {
  await page.goto('/profile')
  await page.getByRole('button', { name: '完善档案', exact: true }).click()

  await expect(page.getByRole('dialog', { name: '完善个人档案' })).toBeVisible()
  await page.getByLabel('当前体重 / kg').fill('71.8')
  await page.getByRole('button', { name: '继续', exact: true }).click()
  await page.getByRole('button', { name: '继续', exact: true }).click()
  await page.getByLabel('过敏与忌口').fill('花生')
  await chooseTime(page, '通常入睡时间', '23:15')
  await page.getByLabel('近期压力状态').selectOption('中等')
  await page.getByRole('button', { name: '保存档案' }).click()

  await expect(page.getByText('个人档案已保存')).toBeVisible()
  await expect(page.getByText('花生', { exact: true })).toBeVisible()
  await expect(page.getByText('23:15', { exact: true })).toBeVisible()
  await expect(page.getByText('中等', { exact: true })).toBeVisible()

  await mainNav(page, '学习')
  await openProfile(page)
  await expect(page.getByText('花生', { exact: true })).toBeVisible()
  await expect(page.getByText('23:15', { exact: true })).toBeVisible()
  await expect(page.getByText('71.8 kg', { exact: true }).first()).toBeVisible()
})

test('settings and profile record consent stay in sync across routes', async ({ page }) => {
  await page.goto('/settings')
  await chooseTime(page, '饮水提醒时间', '10:15')
  await page.getByLabel('启用饮水提醒').uncheck()
  await aiSource(page, '学习记录').uncheck()

  await mainNav(page, '今日')
  await openSettings(page)
  await expect(page.getByLabel('饮水提醒时间')).toContainText('10:15')
  await expect(page.getByLabel('启用饮水提醒')).not.toBeChecked()
  await expect(aiSource(page, '学习记录')).not.toBeChecked()

  await openProfile(page)
  const recordsConsent = page
    .locator('.toggle-row')
    .filter({ hasText: '引用学习与训练记录' })
    .locator('input')
  await expect(recordsConsent).not.toBeChecked()
  await recordsConsent.check()

  await openSettings(page)
  await expect(aiSource(page, '学习记录')).toBeChecked()
  await expect(aiSource(page, '训练记录')).toBeChecked()
})

test('evening review survives leaving and returning to today', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '结束今日' }).click()

  const dialog = page.getByRole('dialog', { name: '结束今日' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: '4', exact: true }).click()
  await dialog.getByLabel('整体状态').selectOption({ label: '专注度不错' })
  await dialog.getByLabel('今日备注').fill('完成了最重要的训练。')
  await dialog.getByRole('button', { name: '保存复盘' }).click()

  await expect(page.getByText('已保存今日复盘 · 精力 4/5')).toBeVisible()
  await expect(page.getByText('精力 4 / 5 · 专注度不错 · 完成了最重要的训练。')).toBeVisible()

  await mainNav(page, '学习')
  await mainNav(page, '今日')
  await expect(page.getByText('精力 4 / 5 · 专注度不错 · 完成了最重要的训练。')).toBeVisible()
})

test('report summaries update from study, diet and water changes', async ({ page }) => {
  await page.goto('/study')
  await page.getByRole('button', { name: '新增记录' }).click()
  await page.getByLabel('学习来源').selectOption('英语真题')
  await page.getByLabel('学习时长 / min').fill('25')
  await chooseTime(page, '开始时间', '16:40')
  await page.getByRole('button', { name: '添加记录' }).click()
  await expect(page.getByText('学习记录已添加')).toBeVisible()

  await mainNav(page, '饮食')
  await page.getByRole('button', { name: '编辑早餐' }).click()
  await page.getByLabel('食物名称').fill('蓝莓')
  await page.getByLabel('热量 / kcal').fill('57')
  await page.getByRole('button', { name: '添加到早餐' }).click()
  await page.getByRole('button', { name: '关闭餐次编辑' }).click()
  await page.getByRole('button', { name: '+ 250 ml' }).click()

  await openReportsFromStudy(page)
  await expect(
    page.getByText('近 7 天共 10 条本地记录，本次可引用 10 条', { exact: false }),
  ).toBeVisible()
  await page.getByRole('button', { name: '查看分析依据' }).click()
  await expect(
    page.getByText('学习记录：近 7 天共 6 条，英语 4 条、高数 2 条，累计 191 分钟'),
  ).toBeVisible()
  await expect(page.getByText('饮食记录：近 7 天 3 个有食物的餐次，共 5 个食物条目')).toBeVisible()
  await expect(
    page.getByText('饮水记录：近 7 天累计 0.25 L（1 次记录，日均 0.04 L）'),
  ).toBeVisible()
})

test('disabled AI sources are reflected in report evidence', async ({ page }) => {
  await page.goto('/settings')
  await aiSource(page, '学习记录').uncheck()
  await aiSource(page, '训练记录').uncheck()

  await openReportsFromStudy(page)
  await page.getByRole('button', { name: '查看分析依据' }).click()
  await expect(page.getByText('学习记录：本次不引用')).toBeVisible()
  await expect(page.getByText('训练记录：本次不引用')).toBeVisible()
  await expect(
    page
      .locator('.reports-data-bars > div')
      .filter({ hasText: '学习记录' })
      .getByText('本次不引用'),
  ).toBeVisible()
})
