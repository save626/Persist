import { expect, test, type Page } from '@playwright/test'
import { seedOwnerFixture } from './owner-fixture'

/**
 * 11-18 事故回归（端到端）：整库导入不能变成「把服务端全删一遍」。
 *
 * 事故链路：手机上点了「加载完整演示数据」→ 本机实体整体替换 → 同步差分把
 * 「基线里有、这一版没有」的实体判成删除 → 推墓碑 → 服务端 9 条真实数据全被清空。
 *
 * 这条用例在真实页面上重演一次同样的动作：夹具播种 → 开同步（建立基线）→
 * 加载完整演示数据 → 抓所有 push 请求体，断言里面没有一条 deleted。
 * 单元测试只覆盖引擎，这里覆盖 Provider 的接线（标记有没有真的传到引擎）。
 */

interface PushedEntity {
  kind: string
  id: string
  deleted: boolean
}

async function mockSyncApi(page: Page, pushes: PushedEntity[][]) {
  await page.route('**/api/v1/**', (route) => {
    const url = route.request().url()
    if (url.endsWith('/devices')) {
      return route.fulfill({
        json: {
          userId: 'u-e2e',
          deviceId: 'd-e2e',
          token: 'token-e2e',
          recoveryCode: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
        },
      })
    }
    if (url.includes('/devices/revoke')) {
      return route.fulfill({ json: { revoked: true, deviceId: 'd-e2e' } })
    }
    if (url.includes('/sync/bootstrap')) {
      return route.fulfill({ json: { applied: 1, skipped: [], serverRev: 1 } })
    }
    if (url.includes('/sync/push')) {
      const body = route.request().postDataJSON() as { entities?: PushedEntity[] }
      pushes.push(body.entities ?? [])
      return route.fulfill({
        json: { applied: body.entities?.length ?? 0, skipped: [], serverRev: 2 },
      })
    }
    if (url.includes('/sync/pull')) {
      return route.fulfill({ json: { entities: [], nextSince: 2, hasMore: false } })
    }
    return route.fulfill({ status: 404, json: { error: { code: 'not_found', message: 'x' } } })
  })
}

test('加载完整演示数据不会向服务端推删除', async ({ page }) => {
  const pushes: PushedEntity[][] = []
  await mockSyncApi(page, pushes)

  // 先用真实导入链路播种一份「用户自己的数据」（此时同步未开启，不产生任何请求）。
  await seedOwnerFixture(page)

  await page.goto('/settings')
  const syncCard = page.locator('.settings-sync-card')
  await syncCard.getByRole('checkbox', { name: '跨设备同步' }).click()
  // 恢复码出现时 enable() 已经走完 register → bootstrap → pull，基线已经建立。
  await expect(syncCard.locator('.settings-sync-code code')).toHaveText(
    'A1B2C3D4 E5F60718 293A4B5C 6D7E8F90',
  )

  // 整库替换：把本机数据换成另一套 id 完全不同的演示数据。
  await page.getByRole('button', { name: '加载完整演示数据' }).click()
  await expect(page.locator('.toast.show')).toContainText('完整演示数据已加载')

  // 等防抖推送真正发出去：只要出现含演示实体的 push 就说明这一轮已 flush。
  await expect
    .poll(() => pushes.some((entities) => entities.some((entity) => entity.id.startsWith('study-demo'))), {
      timeout: 15_000,
    })
    .toBe(true)

  const pushed = pushes.flat()
  const deletes = pushed.filter((entity) => entity.deleted === true)
  // 关键断言：整库替换后被换掉的那些实体不能在推送里以删除形态出现。
  expect(deletes).toEqual([])
})
