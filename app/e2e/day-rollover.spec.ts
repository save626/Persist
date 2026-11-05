import { expect, test } from '@playwright/test'

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
  const nextMealButton = page.getByRole('button', { name: '记录下一餐' })
  await expect(nextMealButton).toBeVisible()
  await expect(page.locator('.diet-meal')).toHaveCount(4)

  // 等首次水合后的防抖写盘落进 IndexedDB，再把饮食整体挪到昨天。
  await expect.poll(() => moveDietDaysTo(page, localDateKey(-1)), { timeout: 10_000 }).toBe('ok')

  await page.reload()
  await expect(nextMealButton).toBeVisible()
  await expect(page.locator('.diet-meal')).toHaveCount(4)

  // ① 记录下一餐：跨日后仍能打开餐次编辑（修复前这里抛 TypeError、什么都不发生）。
  await nextMealButton.click()
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
