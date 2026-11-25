import { fileURLToPath, URL } from 'node:url'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'
import { parseSiteInfo } from '../deploy/scripts/site-info-core.mjs'

export default defineConfig(({ mode }) => {
  // AI 接口凭据（P0）只允许存在于 mobile 构建，也就是 app/.env.mobile.local。
  // Vite 在 production / development 模式下也会加载 .env、.env.local、.env.production*，
  // 一旦凭据被写进这些文件，它会原样内联进公开的 /app/ 产物——那是无法挽回的泄露。
  // 这里在构建开始前直接失败，把「记得别放错地方」从约定变成机制。
  const env = loadEnv(mode, process.cwd(), '')
  if (mode !== 'mobile' && env.VITE_PERSIST_AI_KEY?.trim()) {
    throw new Error(
      'VITE_PERSIST_AI_KEY 只能用于 mobile 构建（app/.env.mobile.local）。' +
        `当前 mode=${mode} 会把凭据打进公开的 web 产物，已中止构建。`,
    )
  }

  // 移动端 API 基址必须是 HTTPS：设备令牌与同步的健康数据都走这条链路，
  // 明文 HTTP 会被同网段/中间人嗅探并篡改（2026-11-25 安全审查发现）。
  // 仅当显式设置 PERSIST_ALLOW_INSECURE_MOBILE_API=1 时才放行，供本地真机调试；
  // 该豁免不得进入任何出包流程。CI 未设置该变量，故出包天然 fail-fast。
  const mobileApiBase = env.VITE_PERSIST_API_BASE_URL?.trim() ?? ''
  if (
    mode === 'mobile' &&
    mobileApiBase &&
    !/^https:\/\//i.test(mobileApiBase) &&
    env.PERSIST_ALLOW_INSECURE_MOBILE_API !== '1'
  ) {
    throw new Error(
      `mobile 构建的 VITE_PERSIST_API_BASE_URL 必须使用 https://（当前：${mobileApiBase.slice(0, 24)}…）。` +
        '明文 http 会泄露设备令牌与健康数据；本地调试可临时设 PERSIST_ALLOW_INSECURE_MOBILE_API=1 显式豁免。',
    )
  }

  // 网站合规信息（ICP / 公安备案号）。唯一来源是 deploy/site-info.json，
  // 与静态落地页用的是同一份数据、同一套校验——备案号下发后只改那一个 JSON。
  // 校验不通过直接中止构建，避免把编造的备案号发到线上。
  const siteInfo = parseSiteInfo(
    JSON.parse(
      readFileSync(resolve(import.meta.dirname, '..', 'deploy', 'site-info.json'), 'utf8'),
    ),
  )

  return {
    plugins: [react(), tailwindcss()],
    define: {
      __SITE_INFO__: JSON.stringify(siteInfo),
    },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    // 开发与联调：同源 /api 请求转发到本地 Fastify（生产环境由 Nginx 反代，见部署文档）。
    // 前端不接触 API Key，也不知道模型厂商地址，只认自己的 /api。
    server: {
      proxy: {
        '/api': {
          target: process.env.PERSIST_API_TARGET ?? 'http://127.0.0.1:3000',
          changeOrigin: false,
        },
      },
    },
    test: {
      include: ['src/**/*.{test,spec}.{ts,tsx}'],
      environment: 'jsdom',
      setupFiles: ['./vitest.setup.ts'],
      css: true,
    },
  }
})
