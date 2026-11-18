import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { seedOwnerFixture } from './owner-fixture'

/**
 * 客户端恢复演练（P4 的核心链路，服务端那半 2026-11-17 已验）。
 *
 * 服务端把 `persist.sqlite` 换回来，不覆盖浏览器 / APK WebView 里的 IndexedDB；
 * 本机这份数据只有「导出 JSON → 清空 → 再导入」这一条恢复路径，此前从未跑过闭环。
 *
 * 断言口径：
 * - 导出内容必须与库内内容逐切片一致（导出无损）
 * - 清空后业务切片必须全空（owner 基线；demo 有种子、guest 为空，都不适用）
 * - 导入后必须与导出前逐切片一致（恢复无损）
 * - 刷新后仍然一致（真的落盘，不是只活在内存里）
 */

type StoredSlice = Record<string, unknown>

/** 业务切片：与 `ImportableMockData` 的持久化字段一一对应。 */
const SLICES = [
  'goals',
  'planItems',
  'waterLog',
  'studyRecords',
  'dietDays',
  'fitnessSession',
  'fitnessHistory',
  'profile',
  'settings',
  'aiConsent',
  'eveningReview',
  'reports',
  'longTermPlans',
] as const

/** 对顺序不敏感的比较：数组按 `id` 排序，对象按 key 排序。 */
function canonical(value: unknown): string {
  const walk = (input: unknown): unknown => {
    if (Array.isArray(input)) {
      const mapped = input.map(walk)
      const allObjectsWithId = mapped.every(
        (item) => item !== null && typeof item === 'object' && 'id' in (item as object),
      )
      if (allObjectsWithId) {
        return [...mapped].sort((a, b) =>
          String((a as { id: unknown }).id).localeCompare(String((b as { id: unknown }).id)),
        )
      }
      return mapped
    }
    if (input !== null && typeof input === 'object') {
      const record = input as Record<string, unknown>
      return Object.fromEntries(
        Object.keys(record)
          .sort()
          .map((key) => [key, walk(record[key])]),
      )
    }
    return input
  }
  return JSON.stringify(walk(value))
}

/** 直接读本机 IndexedDB 的那条记录：这是「数据到底在不在」的唯一硬证据。 */
async function readStoredData(page: Page): Promise<StoredSlice | null> {
  return page.evaluate(async () => {
    const openDb = () =>
      new Promise<IDBDatabase | null>((resolve) => {
        let request: IDBOpenDBRequest
        try {
          request = indexedDB.open('persist-app')
        } catch {
          resolve(null)
          return
        }
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => resolve(null)
        request.onblocked = () => resolve(null)
      })

    const db = await openDb()
    if (!db) return null
    const record = await new Promise<{ backup?: { data?: unknown } } | null>((resolve) => {
      try {
        const tx = db.transaction('mock-state', 'readonly')
        const request = tx.objectStore('mock-state').get('persist-mock-state')
        request.onsuccess = () => resolve(request.result ?? null)
        request.onerror = () => resolve(null)
      } catch {
        resolve(null)
      }
    })
    db.close()
    return (record?.backup?.data as StoredSlice | undefined) ?? null
  })
}

/** 按切片算出长度，用于在失败信息里一眼看出差在哪一项。 */
function shape(data: StoredSlice | null): Record<string, number | string> {
  const result: Record<string, number | string> = {}
  for (const key of SLICES) {
    const value = data?.[key]
    if (Array.isArray(value)) result[key] = value.length
    else if (value === null || value === undefined) result[key] = 'null'
    else if (typeof value === 'object') result[key] = `obj:${Object.keys(value).length}`
    else result[key] = String(value)
  }
  return result
}

/** 等防抖写入落盘：持久化 effect 有 200 ms 防抖。 */
async function settle(page: Page) {
  await page.waitForTimeout(700)
}

test('导出的备份能原样还原本机数据（导出 → 清空 → 导入 → 刷新）', async ({ page }) => {
  await seedOwnerFixture(page)
  await settle(page)

  // ① 导出前的库内真身
  const before = await readStoredData(page)
  expect(before, '夹具导入后本机应已有数据').not.toBeNull()
  expect(before?.studyRecords).not.toHaveLength(0)

  // ② 导出，并核对「导出的内容 == 库里的内容」
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: /导出 JSON 备份/ }).click()
  const download = await downloadPromise
  const exportPath = await download.path()
  expect(exportPath).not.toBeNull()

  const exported = JSON.parse(await readFile(exportPath as string, 'utf8')) as {
    version: string
    data: StoredSlice
  }
  expect(exported.version).toBe('0.3.0')
  expect(canonical(exported.data), '导出内容必须等于库内内容').toBe(canonical(before))

  // ③ 清空本机数据：owner 基线是「全空」，这是恢复的前提
  await page.getByRole('button', { name: '清空本机数据' }).click()
  const confirm = page.getByRole('button', { name: '确认清空' })
  await expect(confirm).toBeVisible()
  await confirm.click()
  await expect(page.locator('.toast')).toContainText('本机数据已清空')
  await settle(page)

  const emptied = await readStoredData(page)
  expect(emptied, '清空后仍应有一条基线记录').not.toBeNull()
  for (const key of ['goals', 'planItems', 'waterLog', 'studyRecords', 'dietDays', 'fitnessHistory', 'reports', 'longTermPlans'] as const) {
    expect(emptied?.[key], `清空后 ${key} 应为空`).toEqual([])
  }
  expect(emptied?.fitnessSession).toBeNull()
  expect(emptied?.eveningReview).toBeNull()
  const emptiedShape = shape(emptied)

  // ④ 用刚才那份文件导回来
  await page.locator('.settings-file-input').setInputFiles({
    name: 'persist-restore-drill.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(exported), 'utf8'),
  })
  await expect(page.getByText(/备份已导入/)).toBeVisible()
  await settle(page)

  const restored = await readStoredData(page)
  expect(canonical(restored), '导入后必须与导出前逐切片一致').toBe(canonical(before))
  expect(shape(restored)).toEqual(shape(before))

  // ⑤ 刷新后仍在（证明落盘，而不是只在 React state 里）
  await page.reload()
  await page.locator('.head .eyebrow, .settings-version').first().waitFor({ timeout: 15_000 })
  const reloaded = await readStoredData(page)
  expect(reloaded, '刷新后数据仍在').not.toBeNull()
  expect(canonical(reloaded), '刷新后必须与导出前一致').toBe(canonical(before))
  expect(shape(reloaded)).toEqual(shape(before))

  // ⑥ 页面也认得回来：学习页应能看到夹具里的记录
  await page.goto('/study')
  await expect(page.locator('.study-timeline-row').first()).toBeVisible({ timeout: 15_000 })
  expect(emptiedShape.studyRecords, '清空前后 studyRecords 数量应不同，否则断言无意义').not.toBe(
    shape(before).studyRecords,
  )
})
