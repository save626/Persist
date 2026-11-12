import { expect, test, type Page } from '@playwright/test'
import { createEmptyMockData } from '../src/data/empty-mock-data'
import { INITIAL_MEALS } from '../src/data/diet'
import { INITIAL_PROFILE } from '../src/data/profile'
import { INITIAL_REPORTS } from '../src/data/reports'
import { INITIAL_SETTINGS } from '../src/data/settings'
import { INITIAL_STUDY_RECORDS } from '../src/data/study'
import {
  createPersistedStateRecord,
  PERSIST_STATE_RECORD_ID,
  PERSIST_STATE_STORE_NAME,
  type PersistedStateRecord,
} from '../src/lib/persist-state'
import { todayDateKey } from '../src/lib/history'

async function mainNav(page: Page, path: '/' | '/fitness' | '/diet' | '/study' | '/reports') {
  const mobile = (page.viewportSize()?.width ?? 1280) <= 900
  const nav = mobile ? page.locator('.bottom-nav') : page.locator('.side-nav')
  await nav.locator(`a[href="${path}"]`).click()
}

const PRESET_BUSINESS_STRINGS = [
  '2,100 kcal',
  '2.0 L',
  '90 min',
  '08:35',
  '12:25',
  '15:40',
  '18:30',
  '把训练放在今天的第一优先级',
  '晚餐优先补齐蛋白质',
  '持续记录 7 天',
  '记录起点',
  '力量训练 · 上肢优先',
  '11/14',
  '基础资料已可用',
  '本地示例数据',
  '0 岁',
  '0 / 0',
  '0 / 4',
  '0 kcal',
  '本周 0 min',
  '已填 0/13',
  '0 份',
  '0 项开启',
  '3 / 3',
  '4 / 4',
  '09:00',
  '18:00',
  '21:45',
  '21:00',
]

async function expectNoPresetBusinessData(page: Page) {
  await expect(page.locator('body')).not.toContainText(PRESET_BUSINESS_STRINGS)
}

async function writePersistedRecord(page: Page, record: PersistedStateRecord) {
  await page.evaluate(
    async ({ storeName, recordId, value }) => {
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('persist-app', 1)
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains(storeName)) {
            request.result.createObjectStore(storeName, { keyPath: 'id' })
          }
        }
        request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'))
        request.onsuccess = () => {
          const database = request.result
          const transaction = database.transaction(storeName, 'readwrite')
          transaction.objectStore(storeName).put({ ...value, id: recordId })
          transaction.onerror = () =>
            reject(transaction.error ?? new Error('IndexedDB write failed'))
          transaction.oncomplete = () => {
            database.close()
            resolve()
          }
        }
      })
    },
    { storeName: PERSIST_STATE_STORE_NAME, recordId: PERSIST_STATE_RECORD_ID, value: record },
  )
}

async function readPersistedSchemaVersion(page: Page) {
  return page.evaluate(
    async ({ storeName, recordId }) =>
      new Promise<number | null>((resolve, reject) => {
        const request = indexedDB.open('persist-app', 1)
        request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'))
        request.onsuccess = () => {
          const database = request.result
          const transaction = database.transaction(storeName, 'readonly')
          const getRequest = transaction.objectStore(storeName).get(recordId)
          getRequest.onerror = () => reject(getRequest.error ?? new Error('IndexedDB read failed'))
          getRequest.onsuccess = () => {
            const raw = getRequest.result as { schemaVersion?: unknown } | undefined
            database.close()
            resolve(typeof raw?.schemaVersion === 'number' ? raw.schemaVersion : null)
          }
        }
      }),
    { storeName: PERSIST_STATE_STORE_NAME, recordId: PERSIST_STATE_RECORD_ID },
  )
}

test('legacy v2 owner seed is scrubbed from an existing browser database', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.today-empty-state')).toBeVisible()

  const today = todayDateKey()
  const data = createEmptyMockData()
  data.goals = [
    {
      id: 'goal-1',
      title: '高数阶段测验',
      date: '2026-11-15',
      time: '19:00',
      enabled: true,
      tone: 'primary',
    },
  ]
  data.planItems = [
    {
      id: 'morning',
      date: today,
      name: '早餐与晨间记录',
      time: '08:20',
      detail: '380 kcal · 睡眠 7 小时 10 分',
      kind: 'default',
      done: true,
    },
  ]
  data.studyRecords = INITIAL_STUDY_RECORDS.map((record) => ({ ...record }))
  data.dietDays = [
    {
      date: today,
      meals: INITIAL_MEALS.map((meal) => ({
        ...meal,
        entries: meal.entries.map((entry) => ({ ...entry })),
      })),
    },
  ]
  data.profile = { ...INITIAL_PROFILE }
  data.settings = structuredClone(INITIAL_SETTINGS)
  data.reports = INITIAL_REPORTS.map((report) => ({ ...report }))

  const record = createPersistedStateRecord(data, null, new Date('2026-11-12T03:00:00.000Z'))
  record.schemaVersion = 2
  await writePersistedRecord(page, record)
  await page.reload()

  await expect(page.locator('.today-empty-state')).toContainText('今天还没有记录')
  await page.goto('/diet')
  await expect(page.locator('.diet-empty-state')).toBeVisible()
  await page.goto('/study')
  await expect(page.locator('.study-empty-state')).toBeVisible()
  await page.goto('/profile')
  await expect(page.locator('.profile-empty-state')).toBeVisible()
  await page.goto('/reports')
  await expect(page.locator('.reports-empty-state')).toBeVisible()
  await expectNoPresetBusinessData(page)
  await expect.poll(() => readPersistedSchemaVersion(page)).toBe(3)
})

test('demo mode preloads complete data and serves prebuilt AI without API calls', async ({
  page,
}) => {
  const apiCalls: string[] = []
  await page.route('**/api/**', (route) => {
    apiCalls.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`)
    return route.abort()
  })

  await page.goto('/?mode=demo')
  await expect(page.locator('.countdowns .countdown')).toHaveCount(2)
  await expect(page.locator('.plan-panel .badge')).toHaveText('3 / 7')
  await expect(page.getByRole('region', { name: '今日进度' })).toContainText('2.0')

  const quickRecordFab = page.locator('.fab')
  if ((page.viewportSize()?.width ?? 1280) <= 900) {
    await expect(quickRecordFab).toBeVisible()
    await expect(quickRecordFab).toBeDisabled()
  } else {
    await expect(quickRecordFab).toBeHidden()
  }

  // Product navigation drops the query string; the session mode must remain demo.
  await mainNav(page, '/fitness')
  await expect(page).toHaveURL(/\/fitness$/)

  await mainNav(page, '/study')
  await expect(page.locator('.study-timeline-row')).toHaveCount(2)
  await expect(page.locator('.study-timeline-row').filter({ hasText: '百词斩' })).toBeVisible()
  await expect(
    page.locator('.study-timeline-row').filter({ hasText: '高数错题复盘' }),
  ).toBeVisible()
  await expect(page.getByText('这个分类今天还没有记录')).toHaveCount(0)
  await page.goto('/')
  await expect(page.locator('.plan-panel .badge')).toHaveText('3 / 7')
  await expect(page.getByRole('region', { name: '今日进度' })).toContainText('2.0')

  await page.goto('/settings')
  await expect(page.locator('input.toggle-input[aria-label="跨设备同步"]')).toBeDisabled()

  await page.goto('/reports')
  await expect(page.locator('.reports-mock-badge')).toContainText('部署前预生成 · 只读')
  await page.getByRole('button', { name: '查看预生成简报', exact: true }).click()
  const detail = page.getByRole('dialog')
  await expect(detail).toContainText('部署前通过 deepseek-chat 生成')
  await expect(detail).toContainText('部署后只读，不再调用 AI')
  await expect(detail.getByRole('button', { name: '应用建议' })).toHaveCount(0)
  await page.keyboard.press('Escape')

  const prebuiltAnalysis = page.getByRole('region', { name: '服务端综合分析' })
  await expect(prebuiltAnalysis).toContainText('部署前通过 DeepSeek')
  await expect(prebuiltAnalysis).not.toContainText('正在生成服务端综合分析')

  await page.goto('/')
  await page.getByRole('button', { name: '晨间简报' }).click()
  const brief = page.getByRole('dialog', { name: '晨间简报' })
  await expect(brief).toContainText('部署前通过 DeepSeek 生成并固化')
  await page.keyboard.press('Escape')

  await page.goto('/plans')
  await expect(page.getByText('部署前预生成 · 只读')).toBeVisible()
  await page.getByRole('button', { name: '查看预置建档' }).first().click()
  const chat = page.getByRole('dialog', { name: 'AI 建档对话' })
  await expect(chat).toContainText('部署前真实生成 · 当前只读')
  await expect(chat).toContainText('12 周增肌与体态改善计划')
  await expect(chat.getByLabel('对话输入')).toHaveCount(0)
  await page.keyboard.press('Escape')

  expect(apiCalls).toEqual([])

  const databaseNames = await page.evaluate(async () =>
    (await indexedDB.databases()).map((database) => database.name),
  )
  expect(databaseNames).not.toContain('persist-app')
  expect(databaseNames).not.toContain('persist-app-demo')
})

test('guest mode starts empty and never calls AI endpoints', async ({ page }) => {
  const apiCalls: string[] = []
  await page.route('**/api/**', (route) => {
    apiCalls.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`)
    return route.abort()
  })

  await page.goto('/?mode=guest')
  await expect(page.locator('.today-empty-state')).toContainText('今天还没有记录')
  await expect(page.locator('.countdowns')).toHaveCount(0)
  await expect(page.locator('.plan-panel')).toHaveCount(0)
  await expect(page.locator('.metrics')).toHaveCount(0)
  await expectNoPresetBusinessData(page)

  await mainNav(page, '/fitness')
  await expect(page.locator('.fit-exercise')).toHaveCount(0)
  await expect(page.getByText('杠铃平板卧推')).toHaveCount(0)
  await expect(page.getByText('常用模板')).toHaveCount(0)
  await expect(page.getByText('还没有动作。点击“记录运动”添加第一组训练。')).toBeVisible()
  await expect(page.locator('.fit-week')).toContainText('0 次')
  await expect(page.locator('.fit-week')).toContainText('暂无')
  await expect(page.locator('.fit-muscles')).toContainText('0 组')

  await page.goto('/profile')
  await expect(page.locator('.profile-empty-state')).toContainText('还没有个人档案')
  await expect(page.locator('.profile-completion')).toHaveCount(0)
  await expectNoPresetBusinessData(page)

  await page.goto('/diet')
  await expect(page.locator('.diet-empty-state')).toContainText('今天还没有饮食与饮水记录')
  await expect(page.locator('.diet-meal')).toHaveCount(0)
  await expect(page.getByRole('region', { name: '今日营养进度' })).toHaveCount(0)
  await expectNoPresetBusinessData(page)

  await page.goto('/study')
  await expect(page.locator('.study-empty-state')).toContainText('今天还没有学习记录')
  await expect(page.locator('.study-metrics')).toHaveCount(0)
  await expect(page.locator('.study-trend-total')).toHaveCount(0)
  await expectNoPresetBusinessData(page)

  await page.goto('/settings')
  await expect(page.locator('input.toggle-input[aria-label="跨设备同步"]')).toBeDisabled()
  await expect(page.locator('.settings-sync-disclosure')).toContainText(
    '桌面演示 / 体验模式不创建同步账号',
  )
  await expect(page.locator('.settings-hero-stats')).toContainText('未设置')
  await expectNoPresetBusinessData(page)

  await page.goto('/reports')
  await expect(page.locator('.reports-empty-state')).toContainText('还没有可复盘的记录')
  await expect(page.locator('.reports-history-count')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '去记录', exact: true })).toBeVisible()
  await expectNoPresetBusinessData(page)

  await page.goto('/plans')
  await expect(page.locator('.plans-list')).toHaveCount(0)
  await page.locator('.plans-head-actions').getByRole('button', { name: 'AI 建档' }).click()
  const chat = page.getByRole('dialog', { name: 'AI 建档对话' })
  await expect(chat).toBeVisible()
  await chat.getByLabel('对话输入').fill('我想每周训练三次，帮我把计划整理出来')
  await chat.getByRole('button', { name: '发送', exact: true }).click()
  await expect(chat.getByRole('button', { name: '去确认草案' })).toBeVisible()
  await page.keyboard.press('Escape')

  expect(apiCalls).toEqual([])

  const databaseNames = await page.evaluate(async () =>
    (await indexedDB.databases()).map((database) => database.name),
  )
  expect(databaseNames).toContain('persist-app-guest')
  expect(databaseNames).not.toContain('persist-app')
})

test('owner starts without preset business data across every module', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.today-empty-state')).toContainText('今天还没有记录')
  await expect(page.locator('.countdowns')).toHaveCount(0)
  await expect(page.locator('.plan-panel')).toHaveCount(0)
  await expect(page.locator('.metrics')).toHaveCount(0)
  await expectNoPresetBusinessData(page)

  await mainNav(page, '/fitness')
  await expect(page.locator('.fit-exercise')).toHaveCount(0)
  await expect(page.locator('.fit-week')).toContainText('0 次')
  await expect(page.locator('.fit-week')).toContainText('暂无')
  await expect(page.locator('.fit-muscles')).toContainText('0 组')

  await mainNav(page, '/diet')
  await expect(page.locator('.diet-empty-state')).toContainText('今天还没有饮食与饮水记录')
  await expect(page.locator('.diet-meal')).toHaveCount(0)
  await expect(page.getByRole('region', { name: '今日营养进度' })).toHaveCount(0)
  await expectNoPresetBusinessData(page)

  await mainNav(page, '/study')
  await expect(page.locator('.study-empty-state')).toContainText('今天还没有学习记录')
  await expect(page.locator('.study-metrics')).toHaveCount(0)
  await expect(page.locator('.study-trend-total')).toHaveCount(0)
  await expectNoPresetBusinessData(page)

  await page.goto('/profile')
  await expect(page.locator('.profile-empty-state')).toContainText('还没有个人档案')
  await expect(page.locator('.profile-completion')).toHaveCount(0)
  await expect(page.getByText('已填 0/13')).toHaveCount(0)
  await expectNoPresetBusinessData(page)

  await mainNav(page, '/reports')
  await expect(page.locator('.reports-empty-state')).toContainText('还没有可复盘的记录')
  await expect(page.locator('.reports-history-count')).toHaveCount(0)
  await expectNoPresetBusinessData(page)

  await page.goto('/settings')
  await expect(page.locator('.settings-hero-stats')).toContainText('未设置')
  await expect(page.locator('.settings-reminder-row.is-off')).toHaveCount(3)
  await expectNoPresetBusinessData(page)

  await page.goto('/plans')
  await expect(page.locator('.plans-list')).toHaveCount(0)
  await expectNoPresetBusinessData(page)
})
