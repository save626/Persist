import { expect, type Locator, type Page } from '@playwright/test'

function splitTime(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value)
  if (!match) throw new Error(`invalid time: ${value}`)
  return { hour: match[1], minute: match[2] }
}

export async function chooseTime(
  page: Page,
  label: string,
  value: string,
  scope: Locator = page,
) {
  const { hour, minute } = splitTime(value)
  const trigger = scope.getByLabel(label, { exact: true })
  await trigger.click()

  const dialog = page.getByRole('dialog', { name: `选择${label}` })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: `${hour} 时`, exact: true }).click()
  await dialog.getByRole('button', { name: `${minute} 分`, exact: true }).click()
  await dialog.getByRole('button', { name: '确定', exact: true }).click()

  await expect(dialog).toBeHidden()
  await expect(trigger).toContainText(value)
}

export async function chooseDate(
  page: Page,
  label: string,
  value: string,
  scope: Locator = page,
) {
  const targetMonth = value.slice(0, 7)
  const trigger = scope.getByLabel(label, { exact: true })
  await trigger.click()

  const dialog = page.getByRole('dialog', { name: `选择${label}` })
  await expect(dialog).toBeVisible()
  const calendar = dialog.locator('.date-time-calendar')

  for (let step = 0; step < 36; step += 1) {
    const currentMonth = await calendar.getAttribute('data-view-month')
    if (currentMonth === targetMonth) break
    await dialog
      .getByRole('button', {
        name: currentMonth && currentMonth < targetMonth ? '下个月' : '上个月',
        exact: true,
      })
      .click()
  }

  await expect(calendar).toHaveAttribute('data-view-month', targetMonth)
  await dialog.locator(`[data-date="${value}"]`).click()
  await dialog.getByRole('button', { name: '确定', exact: true }).click()

  await expect(dialog).toBeHidden()
  const [year, month, day] = value.split('-').map(Number)
  await expect(trigger).toContainText(`${year}年${month}月${day}日`)
}