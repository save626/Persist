import { chromium } from 'playwright'

const baseUrl = process.env.PERSIST_URL ?? 'http://127.0.0.1:4173'
const outputDir = new URL('../../design/', import.meta.url)
const viewports = [
  { name: 'desktop-1440', width: 1440, height: 1000, fullPage: true },
  { name: 'tablet-500', width: 500, height: 960, fullPage: true },
  { name: 'mobile-430', width: 430, height: 932, fullPage: true },
  // 真机参考：6.78 英寸 20:9 直屏，物理 1264x2780 @3x ≈ 421x926 CSS 像素。
  { name: 'mobile-20x9-421', width: 421, height: 926, fullPage: true },
  { name: 'mobile-390', width: 390, height: 844, fullPage: true },
  { name: 'mobile-360', width: 360, height: 800, fullPage: true },
]
const OPEN_DIALOG =
  '.backdrop.open [role="dialog"], .surface-backdrop.open [role="dialog"], .surface-backdrop.open [role="alertdialog"]'

const MANUAL_PLAN = {
  title: '12 周减脂计划',
  goal: '体脂率降到 18%，每周保底 3 次力量训练',
}
const SECOND_PLAN = {
  title: '8 周体能恢复计划',
  goal: '先把睡眠和体能拉回来，每周 2 次轻量训练',
}
// 与 e2e/plans.spec.ts 同一句建档开场，保证截图展示的是真实 Mock 对话输出。
const ONBOARD_INPUT = '我今年 28 岁，身高 175，体重 80 公斤，想减脂，每周练 4 次，帮我生成计划'

async function openBlankManualDraft(page) {
  await page.locator('.plans-head').waitFor({ state: 'visible', timeout: 20_000 })
  const headerButton = page.locator('.plans-head-actions').getByRole('button', { name: '手工新建' })
  if (await headerButton.isVisible()) {
    await headerButton.click()
  } else {
    // 窄屏下 .head-actions 的次要按钮按设计隐藏，改从空状态面板进入。
    await page.locator('.plans-empty-actions').getByRole('button', { name: '手工新建' }).click()
  }
  const dialog = page.getByRole('dialog', { name: '手工新建长期计划' })
  await dialog.waitFor({ state: 'visible' })
  return dialog
}

async function openAdjustDraft(page) {
  await page.locator('.plans-current').getByRole('button', { name: '调整计划' }).click()
  const dialog = page.getByRole('dialog', { name: '手工新建长期计划' })
  await dialog.waitFor({ state: 'visible' })
  return dialog
}

async function openManualDraft(page, { title, goal }, open = openBlankManualDraft) {
  const dialog = await open(page)
  if (title) await dialog.getByLabel('计划标题').fill(title)
  if (goal) await dialog.getByLabel('目标', { exact: true }).fill(goal)
  return dialog
}

async function installAiOfflineMock(page, options = {}) {
  // 视觉检查必须可重复：在页面内截断 /api/*，避免本机 .env.mobile.local 指向真实服务端后
  // 因跨源 CORS 或网络状态把布局检查误判为失败。页面仍会走既有的“AI 不可用”降级分支。
  // 同步接口例外：给「成功但没有数据」的应答。`settings-sync-on` 要的是「同步已开启」这个
  // 渲染分支，若按 503 处理，引擎会落进错误态，说明文字被错误提示挤掉甚至换气口。
  // `syncFailure: 'rate-limited'` 让同步接口返回 429，用来截「限流」这一分支的文案
  // （P5-4）。默认仍是「成功但无数据」，既有状态不受影响。
  const syncFailure = options.syncFailure ?? null
  // `health` 用来造「测试服务端连接」的成功 / 降级两种结局。默认不处理 /api/health
  // （落到下面那条 503），所以既有状态里设置页仍停在「未测试」，不受影响。
  const healthMode = options.health ?? null
  await page.addInitScript(
    ({ syncFailureKind, healthKind }) => {
      const originalFetch = window.fetch.bind(window)
      const json = (body) =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      window.fetch = async (input, init) => {
        const rawUrl =
          typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
        const pathname = new URL(rawUrl, window.location.href).pathname
        if (pathname === '/api/health' && healthKind) {
          // 与 server/src/routes/health.ts 的返回同形：只改 status / db / version 三个字段。
          return json({
            status: healthKind === 'degraded' ? 'degraded' : 'ok',
            service: 'persist-server',
            ai: 'deepseek',
            model: 'deepseek-chat',
            time: '2026-11-17T10:00:00.000Z',
            db: healthKind === 'degraded' ? 'error' : 'ok',
            version: 4,
            storage: { usedPercent: 13.6, status: 'ok' },
            warnings: [],
          })
        }
        if (pathname === '/api/v1/sync/pull') {
          if (syncFailureKind === 'rate-limited') {
            return new Response(
              JSON.stringify({
                error: { code: 'rate_limited', message: '请求过于频繁，请稍后再试。' },
              }),
              {
                status: 429,
                headers: { 'content-type': 'application/json', 'retry-after': '7' },
              },
            )
          }
          return json({ entities: [], nextSince: 0, hasMore: false })
        }
        if (pathname === '/api/v1/sync/push' || pathname === '/api/v1/sync/bootstrap') {
          let applied = 0
          try {
            applied = JSON.parse(init?.body ?? '{}')?.entities?.length ?? 0
          } catch {
            applied = 0
          }
          return json({ applied, skipped: [], serverRev: 0 })
        }
        if (pathname.startsWith('/api/')) {
          return new Response(
            JSON.stringify({
              error: { code: 'ai_unavailable', message: 'visual check: external AI disabled' },
            }),
            {
              status: 503,
              headers: { 'content-type': 'application/json' },
            },
          )
        }
        return originalFetch(input, init)
      }
    },
    { syncFailureKind: syncFailure, healthKind: healthMode },
  )
}

/**
 * 让设置页停在「同步已开启」状态，用于截 A3 的同步说明与恢复码区块。
 *
 * 为什么不点开关：点开关会真的去 `POST /api/v1/devices` 建账号，脚本里没有后端。
 * 这里直接往 `persist-sync` 写一条 enabled 的 meta，重载后由引擎自己 hydrate。
 * 「点开关 → 恢复码」这条真实路径已由 `e2e/smoke.spec.ts` 的
 * 「settings can enable sync against a mocked device API」覆盖，视觉只负责像素。
 * 代价：`SyncMetaRecord` 改形状时这里会跟着失败——正是想要的效果，别默默漂移。
 * 为什么固定时钟：「最近同步」由引擎用 `Date.now()` 写入并在页面里格式化，
 * 不冻结就会每跑一次基线变一次，制造假差异。
 */
async function enableSyncForScreenshot(page) {
  await page.evaluate(async () => {
    const open = () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open('persist-sync', 1)
        request.onupgradeneeded = () => {
          const db = request.result
          if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'id' })
          if (!db.objectStoreNames.contains('outbox'))
            db.createObjectStore('outbox', { keyPath: 'id' })
        }
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
    const db = await open()
    await new Promise((resolve, reject) => {
      const tx = db.transaction('meta', 'readwrite')
      tx.objectStore('meta').put({
        id: 'persist-sync-meta',
        enabled: true,
        userId: 'visual-check-user',
        deviceId: 'visual-check-device',
        token: 'pst_visual_check_device_token',
        recoveryCode: '4f2c9a1b7d3e50618c4a2f9d6b0e735a',
        deviceLabel: '视觉检查设备',
        bootstrapDone: true,
        lastPulledRev: 0,
        lastSyncAt: null,
        entityTimes: {},
        entityHashes: {},
      })
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  })
  await page.clock.setFixedTime(new Date('2026-11-17T12:00:00+08:00'))
  await page.reload({ waitUntil: 'networkidle' })
}

async function dismissToast(page) {
  const toast = page.locator('.toast.show')
  if ((await toast.count()) > 0) {
    await toast.waitFor({ state: 'hidden', timeout: 6000 })
  }
}

async function createPlan(page, { title, goal }, open = openBlankManualDraft) {
  await openManualDraft(page, { title, goal }, open)
  await page.getByRole('button', { name: '确认并启用' }).click()
  await page.locator('.plans-current h2').filter({ hasText: title }).waitFor({ state: 'visible' })
  await dismissToast(page)
}

async function openDraftSheet(page) {
  await openManualDraft(page, MANUAL_PLAN)
}

async function openAiChat(page) {
  await page.locator('.plans-head-actions').getByRole('button', { name: 'AI 建档' }).click()
  await page.getByRole('dialog', { name: 'AI 建档对话' }).waitFor({ state: 'visible' })
  await page.getByLabel('对话输入').fill(ONBOARD_INPUT)
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await page
    .getByRole('button', { name: '去确认草案' })
    .waitFor({ state: 'visible', timeout: 20_000 })
  await page.waitForTimeout(250)
}

async function openActivateConfirm(page) {
  await createPlan(page, MANUAL_PLAN)
  // 第二次进入用「调整计划」，窄屏下同样可用，确认后旧计划自动归档。
  await createPlan(page, SECOND_PLAN, openAdjustDraft)
  const archivedRow = page
    .locator('.plans-side-column .plans-row')
    .filter({ hasText: MANUAL_PLAN.title })
  await archivedRow.waitFor({ state: 'visible' })
  await archivedRow.getByRole('button', { name: '重新启用' }).click()
  await page.getByRole('alertdialog', { name: '启用这份计划？' }).waitFor({ state: 'visible' })
}

const pages = [
  { slug: 'home', path: '/' },
  { slug: 'fitness', path: '/fitness' },
  { slug: 'diet', path: '/diet' },
  // owner 从空数据起步（`isBlankStart`），这两页的头部操作条在空白档位下不渲染：
  // 学习页是「今日记录 N 条 / 新增记录」，档案页是「本地优先 / AI 建档 / 完善档案」，
  // 两者在空状态面板里都已有同名入口，留着就是同一动作两个按钮。
  // 光靠像素基线守不住这条——没人会逐像素看 138 张图，所以写成反向断言。
  { slug: 'study', path: '/study', hidden: ['header .head-actions'] },
  { slug: 'profile', path: '/profile', mustShow: ['AI 建档'], hidden: ['header .head-actions'] },
  { slug: 'reports', path: '/reports' },
  { slug: 'settings', path: '/settings' },
  // A3（同步已开启后的说明）默认态不可见，需要先把同步置为已开启。
  {
    slug: 'settings-sync-on',
    path: '/settings',
    ready: '.settings-sync-card',
    setup: enableSyncForScreenshot,
    expect: '.settings-sync-code',
  },
  // P5-4：限流（429）的文案与 401 分开，只有真的 429 才渲染，所以要造这个状态。
  {
    slug: 'settings-sync-limit',
    path: '/settings',
    ready: '.settings-sync-card',
    syncFailure: 'rate-limited',
    setup: enableSyncForScreenshot,
    expect: '.settings-sync-card .surface-error',
  },
  // A5（部署指引 03 的 HTTPS 口径）在弹层里，默认折叠。
  {
    slug: 'settings-deploy',
    path: '/settings',
    ready: '.settings-device-card',
    setup: async (page) => {
      await page.getByRole('button', { name: '自托管部署说明' }).click()
    },
    waitFor: OPEN_DIALOG,
  },
  // 数据使用说明里是「服务端只留 30 天调用记录」这句的实际落点。
  {
    slug: 'settings-privacy',
    path: '/settings',
    ready: '.settings-privacy-card',
    setup: async (page) => {
      await page.getByRole('button', { name: '查看数据使用说明' }).click()
    },
    waitFor: OPEN_DIALOG,
  },
  // 「测试服务端连接」改成真探活之后，成功与降级两条分支各有自己的文案，
  // 不造状态就永远没有基线。不造「连不上」那条：503 会在控制台留一条 error，
  // 与脚本「控制台零错误」的判据冲突，那条分支由 server-health.test.ts 覆盖。
  {
    slug: 'settings-ai-ready',
    path: '/settings',
    ready: '.settings-ai-card',
    health: 'ok',
    setup: async (page) => {
      await page.getByRole('button', { name: '测试服务端连接' }).click()
      // toast 停留 2.2 秒，且浮在卡片上方；不等它消失，基线里会有一块黑色气泡挡住结论文字。
      await dismissToast(page)
    },
    expect: '.settings-ai-card .settings-ai-health',
  },
  {
    slug: 'settings-ai-degraded',
    path: '/settings',
    ready: '.settings-ai-card',
    health: 'degraded',
    setup: async (page) => {
      await page.getByRole('button', { name: '测试服务端连接' }).click()
      await dismissToast(page)
    },
    expect: '.settings-ai-card .surface-error',
  },
  { slug: 'fitness-new', path: '/fitness?new=1', waitFor: OPEN_DIALOG },
  { slug: 'diet-new', path: '/diet?new=1', waitFor: OPEN_DIALOG },
  { slug: 'study-new', path: '/study?new=1', waitFor: OPEN_DIALOG },
  {
    slug: 'study-date-picker',
    path: '/study?new=1',
    waitFor: '.date-time-backdrop.open',
    setup: async (page) => {
      await page.locator(OPEN_DIALOG).waitFor({ state: 'visible' })
      await page.getByLabel('日期').click()
    },
  },
  {
    slug: 'study-time-picker',
    path: '/study?new=1',
    waitFor: '.date-time-backdrop.open',
    setup: async (page) => {
      await page.locator(OPEN_DIALOG).waitFor({ state: 'visible' })
      await page.getByLabel('开始时间').click()
    },
  },
  { slug: 'plans', path: '/plans', ready: '.plans-head' },
  { slug: 'plans-active', path: '/plans', setup: (page) => createPlan(page, MANUAL_PLAN) },
  { slug: 'plans-draft', path: '/plans', waitFor: OPEN_DIALOG, setup: openDraftSheet },
  { slug: 'plans-ai', path: '/plans', waitFor: OPEN_DIALOG, setup: openAiChat },
  { slug: 'plans-confirm', path: '/plans', waitFor: OPEN_DIALOG, setup: openActivateConfirm },
]

function outputPath(filename) {
  return new URL(filename, outputDir).pathname.replace(/^\/([A-Za-z]:)/, '$1')
}

// 只跑指定状态（逗号分隔的 slug），用于反复调一个新状态的构图：
// `PERSIST_VISUAL_ONLY=settings-sync-on npm run visual:check`。
const onlyStates = (process.env.PERSIST_VISUAL_ONLY ?? '')
  .split(',')
  .map((slug) => slug.trim())
  .filter(Boolean)
const activePages = onlyStates.length
  ? pages.filter((pageDef) => onlyStates.includes(pageDef.slug))
  : pages
if (onlyStates.length && activePages.length === 0) {
  console.error(`[visual] 没有匹配的状态：${onlyStates.join(', ')}`)
  process.exit(1)
}

const NO_KEY_REPORT_503 =
  'Failed to load resource: the server responded with a status of 503 (Service Unavailable)'
let aiDisabled = false
try {
  const healthResponse = await fetch(new URL('/api/health', baseUrl))
  const health = await healthResponse.json()
  aiDisabled = healthResponse.ok && health?.status === 'ok' && health?.ai !== 'deepseek'
} catch {
  // 健康检查失败时不做白名单，避免把真正的后端故障藏掉。
}
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const results = []

for (const pageDef of activePages) {
  for (const viewport of viewports) {
    const page = await browser.newPage({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: 1,
    })
    await installAiOfflineMock(page, { syncFailure: pageDef.syncFailure, health: pageDef.health })
    const errors = []
    const expectedNoKeyReport503 = []
    page.on('response', (response) => {
      const url = new URL(response.url())
      if (aiDisabled && response.status() === 503 && url.pathname === '/api/report') {
        expectedNoKeyReport503.push(response.url())
      }
    })
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    page.on('pageerror', (error) => errors.push(error.message))

    await page.goto(`${baseUrl}${pageDef.path}`, { waitUntil: 'networkidle' })
    console.error(`[visual] ${pageDef.slug} ${viewport.name}`)
    if (pageDef.ready) {
      await page.locator(pageDef.ready).waitFor({ state: 'visible', timeout: 20_000 })
    }
    if (pageDef.setup) {
      await pageDef.setup(page)
      await page.waitForTimeout(180)
    }
    if (pageDef.waitFor) {
      await page.locator(pageDef.waitFor).waitFor({ state: 'visible' })
      await page.waitForTimeout(180)
    }
    // `expect` 与 `waitFor` 的区别：只等元素出现，不参与「弹层必须打开」的判定
    // （sync-on 等的是页面里的一个区块，不是弹窗）。
    if (pageDef.expect) {
      await page.locator(pageDef.expect).waitFor({ state: 'visible', timeout: 20_000 })
      await page.waitForTimeout(180)
    }
    const layout = await page.evaluate(
      (openDialogSelector) => ({
        innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
        dialogOpen: Boolean(document.querySelector(openDialogSelector)),
      }),
      OPEN_DIALOG,
    )
    const missingElements = []
    for (const name of pageDef.mustShow ?? []) {
      const visible = await page
        .getByRole('button', { name, exact: true })
        .first()
        .isVisible()
        .catch(() => false)
      if (!visible) missingElements.push(name)
    }
    const unexpectedElements = []
    for (const selector of pageDef.hidden ?? []) {
      const visible = await page
        .locator(selector)
        .first()
        .isVisible()
        .catch(() => false)
      if (visible) unexpectedElements.push(selector)
    }
    const filename =
      pageDef.slug === 'home' ? `${viewport.name}.png` : `${pageDef.slug}-${viewport.name}.png`
    // 弹窗状态只截当前视口：对话框是 fixed 居中定位，整页截图会让它在长图顶部显得“没居中”。
    await page.screenshot({
      path: outputPath(filename),
      fullPage: viewport.fullPage && !pageDef.waitFor,
    })
    let expected503Budget = expectedNoKeyReport503.length
    const unexpectedErrors = errors.filter((message) => {
      if (aiDisabled && message === NO_KEY_REPORT_503 && expected503Budget > 0) {
        expected503Budget -= 1
        return false
      }
      return true
    })
    results.push({
      page: pageDef.slug,
      viewport: viewport.name,
      layout,
      missingElements,
      unexpectedElements,
      errors: unexpectedErrors,
      expectedNoKeyReport503: expectedNoKeyReport503.length - expected503Budget,
    })
    await page.close()
  }
}

async function probeQuickRecord() {
const interactionPage = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
await installAiOfflineMock(interactionPage)
await interactionPage.goto(baseUrl, { waitUntil: 'networkidle' })
await interactionPage.locator('.head-actions .btn.primary').click()
const waterButton = interactionPage.locator('.quick.water')
const box = await waterButton.boundingBox()
const hitTest = box
  ? await interactionPage.evaluate(
      ({ x, y }) => {
        const element = document.elementFromPoint(x, y)
        const describe = (node) => {
          if (!node) return null
          const style = getComputedStyle(node)
          const rect = node.getBoundingClientRect()
          return {
            tag: node.tagName,
            className: node.className,
            zIndex: style.zIndex,
            position: style.position,
            pointerEvents: style.pointerEvents,
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          }
        }
        return {
          hit: describe(element),
          backdrop: describe(document.querySelector('.backdrop')),
          sheet: describe(document.querySelector('.sheet')),
          sidebar: describe(document.querySelector('.sidebar')),
        }
      },
      { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    )
  : null
// 等浮层入场动画（0.22s）结束，避免截图里对话框位置偏移。
await interactionPage.waitForTimeout(360)
await interactionPage.screenshot({
  path: outputPath('desktop-1440-quick-record.png'),
  fullPage: false,
})
results.push({ overlay: { box, hitTest } })
}

// 只跑子集时不重截快速记录：那张图不随状态变化，单跑一次状态却覆盖它等于制造假改动。
if (!onlyStates.length) await probeQuickRecord()

await browser.close()
const pageResults = results.filter((result) => 'page' in result)
const overlayResult = results.find((result) => 'overlay' in result)
const failures = results.filter((result) => {
  if ('overlay' in result) {
    return !result.overlay.box || result.overlay.hitTest?.hit?.className !== 'quick-icon'
  }
  const definition = pages.find((item) => item.slug === result.page)
  const overflow =
    Math.max(result.layout.scrollWidth, result.layout.bodyScrollWidth) >
    result.layout.innerWidth + 1
  const missingDialog = Boolean(definition?.waitFor) && !result.layout.dialogOpen
  const missingElement = (result.missingElements ?? []).length > 0
  const unexpectedElement = (result.unexpectedElements ?? []).length > 0
  return overflow || result.errors.length > 0 || missingDialog || missingElement || unexpectedElement
})
const summary = {
  states: activePages.length,
  screenshots: pageResults.length,
  overflow: pageResults.filter(
    (result) =>
      Math.max(result.layout.scrollWidth, result.layout.bodyScrollWidth) >
      result.layout.innerWidth + 1,
  ).length,
  consoleErrors: pageResults.filter((result) => result.errors.length > 0).length,
  expectedNoKeyReport503: pageResults.reduce(
    (total, result) => total + (result.expectedNoKeyReport503 ?? 0),
    0,
  ),
  missingDialogs: pageResults.filter((result) => {
    const definition = pages.find((item) => item.slug === result.page)
    return Boolean(definition?.waitFor) && !result.layout.dialogOpen
  }).length,
  missingElements: pageResults.filter((result) => (result.missingElements ?? []).length > 0).length,
  unexpectedElements: pageResults.filter((result) => (result.unexpectedElements ?? []).length > 0)
    .length,
  quickRecordReady: Boolean(
    overlayResult &&
    overlayResult.overlay.box &&
    overlayResult.overlay.hitTest?.hit?.className === 'quick-icon',
  ),
  failures: failures.length,
}
console.log(JSON.stringify({ summary, failures }, null, 2))
if (failures.length > 0) process.exitCode = 1
