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
  { slug: 'study', path: '/study' },
  { slug: 'profile', path: '/profile', mustShow: ['AI 建档'] },
  { slug: 'reports', path: '/reports' },
  { slug: 'settings', path: '/settings' },
  { slug: 'fitness-new', path: '/fitness?new=1', waitFor: OPEN_DIALOG },
  { slug: 'diet-new', path: '/diet?new=1', waitFor: OPEN_DIALOG },
  { slug: 'study-new', path: '/study?new=1', waitFor: OPEN_DIALOG },
  { slug: 'plans', path: '/plans', ready: '.plans-head' },
  { slug: 'plans-active', path: '/plans', setup: (page) => createPlan(page, MANUAL_PLAN) },
  { slug: 'plans-draft', path: '/plans', waitFor: OPEN_DIALOG, setup: openDraftSheet },
  { slug: 'plans-ai', path: '/plans', waitFor: OPEN_DIALOG, setup: openAiChat },
  { slug: 'plans-confirm', path: '/plans', waitFor: OPEN_DIALOG, setup: openActivateConfirm },
]

function outputPath(filename) {
  return new URL(filename, outputDir).pathname.replace(/^\/([A-Za-z]:)/, '$1')
}

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const results = []

for (const pageDef of pages) {
  for (const viewport of viewports) {
    const page = await browser.newPage({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: 1,
    })
    const errors = []
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
    const filename =
      pageDef.slug === 'home' ? `${viewport.name}.png` : `${pageDef.slug}-${viewport.name}.png`
    // 弹窗状态只截当前视口：对话框是 fixed 居中定位，整页截图会让它在长图顶部显得“没居中”。
    await page.screenshot({
      path: outputPath(filename),
      fullPage: viewport.fullPage && !pageDef.waitFor,
    })
    results.push({ page: pageDef.slug, viewport: viewport.name, layout, missingElements, errors })
    await page.close()
  }
}

const interactionPage = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
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
  return overflow || result.errors.length > 0 || missingDialog || missingElement
})
const summary = {
  states: pages.length,
  screenshots: pageResults.length,
  overflow: pageResults.filter(
    (result) =>
      Math.max(result.layout.scrollWidth, result.layout.bodyScrollWidth) >
      result.layout.innerWidth + 1,
  ).length,
  consoleErrors: pageResults.filter((result) => result.errors.length > 0).length,
  missingDialogs: pageResults.filter((result) => {
    const definition = pages.find((item) => item.slug === result.page)
    return Boolean(definition?.waitFor) && !result.layout.dialogOpen
  }).length,
  missingElements: pageResults.filter((result) => (result.missingElements ?? []).length > 0).length,
  quickRecordReady: Boolean(
    overlayResult &&
    overlayResult.overlay.box &&
    overlayResult.overlay.hitTest?.hit?.className === 'quick-icon',
  ),
  failures: failures.length,
}
console.log(JSON.stringify({ summary, failures }, null, 2))
if (failures.length > 0) process.exitCode = 1
