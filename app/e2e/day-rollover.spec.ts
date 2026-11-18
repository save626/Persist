import { expect, test } from '@playwright/test'
import { seedOwnerFixture } from './owner-fixture'

/**
 * 跨日回归：本地只留着「昨天」的饮食台账时，今天仍要能继续登记。
 *
 * 2026-11-05 的线上反馈：昨天用过 App，今天打开「饮食」页后
 * 「记录下一餐」点不动、AI 热量登记的餐次下拉没有选项、确认登记也不落库。
 * 根因是 `mealsForDate(今天)` 返回空数组，页面拿 `meals[0].id` 直接抛错。
 */

/** 本地时区的日期键；不能用 toISOString，否则 UTC+8 的凌晨会差一天。 */
function localDateKey(offsetDays: number): string {
  const date = new Date()
  date.setDate(date.getDate() + offsetDays)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** 把 IndexedDB 里唯一那条持久化记录的所有饮食日期改成指定的昨天。 */
async function moveDietDaysTo(
  page: import('@playwright/test').Page,
  dateKey: string,
): Promise<string> {
  return page.evaluate(async (target) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('persist-app', 1)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      const record = await new Promise<unknown>((resolve, reject) => {
        const store = database.transaction('mock-state', 'readonly').objectStore('mock-state')
        const request = store.get('persist-mock-state')
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      if (!record) return 'no-record'
      const days = (record as { backup: { data: { dietDays: Array<{ date: string }> } } }).backup
        .data.dietDays
      for (const day of days) day.date = target
      await new Promise<void>((resolve, reject) => {
        const store = database.transaction('mock-state', 'readwrite').objectStore('mock-state')
        const request = store.put(record)
        request.onsuccess = () => resolve()
        request.onerror = () => reject(request.error)
      })
      return 'ok'
    } finally {
      database.close()
    }
  }, dateKey)
}

test('跨日后饮食页仍有四个餐次，记录与 AI 登记都能落库', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  await page.goto('/diet')
  await expect(page.locator('.diet-empty-state')).toContainText('今天还没有饮食与饮水记录')

  // owner 首启没有空餐次卡；先真实登记一餐，下面的跨日场景才有台账可迁移。
  await page.getByRole('button', { name: '记录第一餐' }).click()
  const breakfast = page.getByRole('dialog', { name: '编辑早餐' })
  await breakfast.getByLabel('食物名称').fill('跨日测试早餐')
  await breakfast.getByLabel('热量 / kcal').fill('120')
  await breakfast.getByRole('button', { name: '添加到早餐' }).click()
  await page.getByRole('button', { name: '关闭餐次编辑' }).click()

  const nextMealButton = page.getByRole('button', { name: '记录下一餐' })
  await expect(nextMealButton).toBeVisible()
  await expect(page.locator('.diet-meal')).toHaveCount(4)

  // 等首次水合后的防抖写盘落进 IndexedDB，再把饮食整体挪到昨天。
  await expect.poll(() => moveDietDaysTo(page, localDateKey(-1)), { timeout: 10_000 }).toBe('ok')

  await page.reload()
  // 新一天仍是已验收的空白首启视觉；点击「记录第一餐」必须能打开空餐次编辑器。
  await expect(page.locator('.diet-empty-state')).toContainText('今天还没有饮食与饮水记录')
  const firstMealButton = page.getByRole('button', { name: '记录第一餐' })
  await expect(firstMealButton).toBeVisible()
  await firstMealButton.click()
  await expect(page.getByRole('dialog', { name: '编辑早餐' })).toBeVisible()
  await page.getByRole('button', { name: '关闭餐次编辑' }).click()

  // ② AI 登记：餐次下拉有四个选项，确认登记后写进对应的餐次。
  await page.getByRole('button', { name: 'AI 热量登记' }).click()
  const aiSheet = page.getByRole('dialog', { name: 'AI 热量登记' })
  await expect(aiSheet).toBeVisible()
  await expect(aiSheet.locator('select option')).toHaveCount(4)
  await aiSheet.locator('select').selectOption('lunch')
  await page
    .getByLabel('AI 识别结果')
    .fill('清蒸鲈鱼\n热量 320 kcal，蛋白质 38 g，碳水 4 g，脂肪 16 g')
  await page.getByRole('button', { name: '解析营养信息' }).click()
  await page.getByRole('button', { name: '确认登记' }).click()

  await expect(page.getByText('已核对并登记 清蒸鲈鱼')).toBeVisible()
  await expect(
    page.locator('.diet-entry-copy strong').filter({ hasText: '清蒸鲈鱼' }),
  ).toBeVisible()
  await expect(page.getByText('0 / 4')).toBeHidden()

  expect(pageErrors).toEqual([])
})

/** 把本地训练会话改写成「昨天已完成」，模拟昨天练完、今天重新打开。 */
async function moveFitnessSessionToYesterday(
  page: import('@playwright/test').Page,
): Promise<string> {
  return page.evaluate(async (target) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('persist-app', 1)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      const record = await new Promise<unknown>((resolve, reject) => {
        const store = database.transaction('mock-state', 'readonly').objectStore('mock-state')
        const request = store.get('persist-mock-state')
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      if (!record) return 'no-record'
      const data = (
        record as { backup: { data: { fitnessSession: Record<string, unknown> | null } } }
      ).backup.data
      if (!data.fitnessSession) return 'no-session'
      data.fitnessSession.date = target
      data.fitnessSession.sessionStatus = 'completed'
      await new Promise<void>((resolve, reject) => {
        const store = database.transaction('mock-state', 'readwrite').objectStore('mock-state')
        const request = store.put(record)
        request.onsuccess = () => resolve()
        request.onerror = () => reject(request.error)
      })
      return 'ok'
    } finally {
      database.close()
    }
  }, localDateKey(-1))
}

/**
 * 2026-11-18 反馈：昨天点过「完成训练」，今天没填任何计划，训练页却显示「今日训练已完成」，
 * 且「完成训练」按钮被禁用，无法开始今天这一次。
 *
 * 根因：`FitnessSessionState` 没有日期归属，而 `fitnessSession` 是单个持久化对象，
 * 跨日没有任何重置。修法是给会话加 `date`，读取时与今天不一致就按「还没开始」处理。
 */
test('跨日后训练不会沿用昨天的「已完成」', async ({ page }) => {
  await seedOwnerFixture(page)
  await page.goto('/fitness')
  await expect(page.locator('.head-actions .status')).toContainText('训练中')

  await expect.poll(() => moveFitnessSessionToYesterday(page), { timeout: 10_000 }).toBe('ok')
  await page.reload()

  // 昨天完成过 ≠ 今天完成过：状态回到「等待记录」，按钮恢复可用。
  await expect(page.locator('.head-actions .status')).toContainText('等待记录')
  const completeButton = page.getByRole('button', { name: '完成训练' })
  await expect(completeButton).toBeEnabled()
})

/** 把本地复盘改成「昨天填的」，模拟昨天收过尾、今天重新打开。 */
async function moveEveningReviewTo(
  page: import('@playwright/test').Page,
  dateKey: string,
): Promise<string> {
  return page.evaluate(async (target) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('persist-app', 1)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      const record = await new Promise<unknown>((resolve, reject) => {
        const store = database.transaction('mock-state', 'readonly').objectStore('mock-state')
        const request = store.get('persist-mock-state')
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      if (!record) return 'no-record'
      const data = (record as { backup: { data: { eveningReview: { date?: string } | null } } })
        .backup.data
      if (!data.eveningReview) return 'no-review'
      data.eveningReview.date = target
      await new Promise<void>((resolve, reject) => {
        const store = database.transaction('mock-state', 'readwrite').objectStore('mock-state')
        const request = store.put(record)
        request.onsuccess = () => resolve()
        request.onerror = () => reject(request.error)
      })
      return 'ok'
    } finally {
      database.close()
    }
  }, dateKey)
}

/**
 * 与训练会话同源的跨日问题：`eveningReview` 也是单个持久化对象。
 * 昨天填完复盘后，今天打开会看到「今天的复盘已经记录」并显示昨天的精力与备注，
 * 复盘弹层还会把昨天的内容当默认值预填。
 *
 * 修法：复盘带 `date`，读取侧只认「今天」的那一份。
 */
test('跨日后晚间复盘不会沿用昨天的内容', async ({ page }) => {
  await seedOwnerFixture(page)
  await page.goto('/')

  const review = page.locator('.review')
  await expect(review.locator('#reviewTitle')).toContainText('今天的记录，已经足够开始复盘。')

  // 今天真实填一次：精力 4 / 状态「专注度不错」/ 一句备注。
  await review.getByRole('button', { name: '结束今日' }).click()
  const sheet = page.getByRole('dialog', { name: '结束今日' })
  await expect(sheet).toBeVisible()
  await sheet.getByRole('button', { name: '4' }).click()
  await sheet.getByLabel('整体状态').selectOption('专注度不错')
  await sheet.getByLabel('今日备注').fill('跨日回归：昨天留下的复盘')
  await sheet.getByRole('button', { name: '保存复盘' }).click()

  await expect(review.locator('#reviewTitle')).toContainText('今天的复盘已经记录。')
  await expect(review).toContainText('精力 4 / 5 · 专注度不错')

  // 等防抖写盘落进 IndexedDB，再把这份复盘挪到昨天。
  await expect.poll(() => moveEveningReviewTo(page, localDateKey(-1)), { timeout: 10_000 }).toBe('ok')

  await page.reload()
  // 昨天填过 ≠ 今天填过：文案回到「可以开始复盘」，按钮回到「结束今日」，
  // 昨天的备注不能出现在今天的卡片里。
  await expect(review.locator('#reviewTitle')).toContainText('今天的记录，已经足够开始复盘。')
  await expect(review.getByRole('button', { name: '结束今日' })).toBeVisible()
  await expect(review).not.toContainText('跨日回归：昨天留下的复盘')
  await expect(review).not.toContainText('精力 4 / 5')
})

/**
 * 跨日的另一半：`today` 原先只在 Provider 挂载时算一次。
 * PWA / APK 常驻后台跨过 0 点后回到前台，整页仍停留在昨天——
 * 今天页会把昨天的计划、饮水、饮食切片继续当成「今天」。
 *
 * 这里不 reload，直接把时钟推过午夜，验证日期标签跟着推进。
 */
test('页面常驻跨过 0 点后，「今天」自动推进到新的一天', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-18T23:58:00') })
  await page.goto('/')

  const eyebrow = page.locator('.head .eyebrow')
  await expect(eyebrow).toContainText('2026年11月18日')

  await page.clock.fastForward('03:00')

  await expect(eyebrow).toContainText('2026年11月19日')
})
