import { expect, test } from '@playwright/test'

type ObservationType = '训练建议' | '饮食观察' | '学习观察'

test('owner mobile observations request real AI with source-scoped digests', async ({ page }) => {
  const requests: { type: ObservationType; digest: Record<string, unknown> }[] = []

  await page.route('**/api/report', async (route) => {
    const body = route.request().postDataJSON() as {
      type: ObservationType
      digest: Record<string, unknown>
    }
    requests.push(body)
    await route.fulfill({
      json: {
        model: 'deepseek-chat',
        report: {
          title: `${body.type}已生成`,
          status: '观察完成',
          summary: '这是一段用于验证真实 AI 观察接入的集成测试内容，模型结果会显示在对应卡片中。',
          conclusions: ['已按当前来源生成观察'],
          actions: ['根据卡片内容继续今天的记录'],
          warnings: [],
        },
      },
    })
  })

  await page.goto('/fitness')
  await page.getByRole('button', { name: /取消杠铃平板卧推第 1 组完成/ }).click()
  await expect(page.locator('#fitnessAiTitle')).toHaveText('训练建议已生成')

  await page.goto('/diet')
  await expect(page.locator('#dietObservationTitle')).toHaveText('饮食观察已生成')

  await page.goto('/study')
  await expect(page.locator('#studyAiTitle')).toHaveText('学习观察已生成')

  expect(requests.map((request) => request.type)).toEqual(['训练建议', '饮食观察', '学习观察'])
  expect(requests[0]?.digest.fitness).not.toBeNull()
  expect(requests[0]?.digest.diet).toBeNull()
  expect(requests[0]?.digest.study).toBeNull()
  expect(requests[1]?.digest.diet).not.toBeNull()
  expect(requests[1]?.digest.fitness).toBeNull()
  expect(requests[1]?.digest.study).toBeNull()
  expect(requests[2]?.digest.study).not.toBeNull()
  expect(requests[2]?.digest.fitness).toBeNull()
  expect(requests[2]?.digest.diet).toBeNull()
})
