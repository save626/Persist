import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

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

  return {
    plugins: [react(), tailwindcss()],
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
