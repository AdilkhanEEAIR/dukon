/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    // Самый крупный кусок — ECharts (~190 КБ gzip), он грузится лениво, только когда на экране есть график.
    chunkSizeWarningLimit: 600,
    rolldownOptions: {
      output: {
        // Библиотеки меняются реже кода приложения — отдельные чанки кэшируются браузером между деплоями.
        advancedChunks: {
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/ },
            { name: 'motion', test: /node_modules[\\/](motion|motion-dom|motion-utils|framer-motion)[\\/]/ },
            { name: 'icons', test: /node_modules[\\/]lucide-react[\\/]/ },
            { name: 'echarts', test: /node_modules[\\/](echarts|zrender)[\\/]/ },
          ],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
    css: false,
    testTimeout: 10_000,
  },
})
