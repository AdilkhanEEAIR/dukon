/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    // Крупные куски — MapLibre (~290 КБ gzip) и ECharts (~190 КБ gzip): оба грузятся лениво, только на экранах
    // с картой или графиком, поэтому порог предупреждения поднят до их размера, а не до размера всего приложения.
    chunkSizeWarningLimit: 1100,
    rolldownOptions: {
      output: {
        // Библиотеки меняются реже кода приложения — отдельные чанки кэшируются браузером между деплоями.
        // codeSplitting — новое имя advancedChunks в Vite 8 (rolldown); старое печатало предупреждение при сборке.
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/ },
            { name: 'motion', test: /node_modules[\\/](motion|motion-dom|motion-utils|framer-motion)[\\/]/ },
            { name: 'icons', test: /node_modules[\\/]lucide-react[\\/]/ },
            { name: 'echarts', test: /node_modules[\\/](echarts|zrender)[\\/]/ },
            { name: 'maplibre', test: /node_modules[\\/](maplibre-gl|@maplibre|@mapbox)[\\/]/ },
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
