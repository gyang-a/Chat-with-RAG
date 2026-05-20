import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { visualizer } from 'rollup-plugin-visualizer'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(),visualizer({
      filename: 'dist/stats.html',  // 输出文件
      open: true,                    // 打包后自动打开
      gzipSize: true,                // 显示 gzip 后大小
      brotliSize: true,              // 显示 brotli 后大小
    })],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          const normalizedId = id.replaceAll('\\', '/')

          if (normalizedId.includes('/react/') || normalizedId.includes('/react-dom/')) {
            return 'react-vendor'
          }

          if (normalizedId.includes('lucide-react') || normalizedId.includes('@radix-ui') || normalizedId.includes('sonner')) {
            return 'ui-vendor'
          }

          if (normalizedId.includes('@chenglou/pretext') || normalizedId.includes('react-virtuoso')) {
            return 'chat-vendor'
          }

          if (normalizedId.includes('react-syntax-highlighter')) {
            return 'syntax-vendor'
          }

          if (
            normalizedId.includes('katex') ||
            normalizedId.includes('remark-math') ||
            normalizedId.includes('rehype-katex')
          ) {
            return 'markdown-math-vendor'
          }

          if (
            normalizedId.includes('react-markdown') ||
            normalizedId.includes('remark-') ||
            normalizedId.includes('rehype-') ||
            normalizedId.includes('micromark')
          ) {
            return 'markdown-parser-vendor'
          }

          return 'vendor'
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: [
      {
        // 仅匹配 "@/" 开头的应用内路径，避免与 npm scope 包（如 @chenglou/*）冲突
        find: /^@\//,
        replacement: `${path.resolve(__dirname, './src')}/`,
      },
    ],
  },
})
