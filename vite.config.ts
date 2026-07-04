import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import wasm from 'vite-plugin-wasm'
import topLevelAwait from 'vite-plugin-top-level-await'
import fs from 'fs'
import path from 'path'

// Custom plugin to copy files to output directory
const copyUpdateLogs = () => {
  return {
    name: 'copy-update-logs',
    closeBundle() {
      const src1 = path.resolve(__dirname, 'UPDATE_LOG.md')
      const src2 = path.resolve(__dirname, 'UPDATE_LOG_EN.md')
      const destDir = path.resolve(__dirname, 'dist')
      
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true })
      }
      
      if (fs.existsSync(src1)) {
        fs.copyFileSync(src1, path.resolve(destDir, 'UPDATE_LOG.md'))
      }
      if (fs.existsSync(src2)) {
        fs.copyFileSync(src2, path.resolve(destDir, 'UPDATE_LOG_EN.md'))
      }
    }
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [
    react(),
    wasm(),
    topLevelAwait(),
    copyUpdateLogs(),
  ],
  worker: {
    plugins: () => [wasm(), topLevelAwait()],
    format: 'es',
  },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  build: {
    target: 'esnext',
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          uplot: ['uplot'],
        },
      },
    },
  },
  optimizeDeps: {
    exclude: ['ulog-parser-wasm'],
  },
})
