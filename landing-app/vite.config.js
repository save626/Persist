/**
 * Vite 配置（`npm run dev` / `vite build` 都读这里）。
 *
 * 正式构建仍走 `scripts/build.mjs`（configFile:false，自带同样的 IIFE 输出与内联步骤）；
 * 这份文件负责两件事：
 *   1. dev server 的 HMR 能解析 `@fusion/*` —— 粒子舞台直接复用
 *      `gesture-particle-fusion-20261121/src`，不复制第二份代码；
 *   2. 单独跑 `vite build` 时保持原来的单 IIFE 产物形态。
 * 两份配置里的 build 字段要保持一致，改一处记得改另一处。
 */
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(fileURLToPath(import.meta.url))
const FUSION_ROOT = resolve(ROOT, '..', 'gesture-particle-fusion-20261121')

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: { '@fusion': resolve(FUSION_ROOT, 'src') },
  },
  server: {
    fs: {
      // 允许 dev server 读取仓库内相邻的融合工程
      allow: [ROOT, FUSION_ROOT],
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        format: 'iife',
        name: 'PersistLanding',
        inlineDynamicImports: true,
        entryFileNames: 'app.js',
        assetFileNames: 'app.[ext]',
      },
    },
  },
})
