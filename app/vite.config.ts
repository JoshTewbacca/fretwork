import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'
import { alphaTab } from '@coderline/alphatab-vite'

// vite-plugin-pwa configuration is added by the PWA task (delegation map 0.5).
export default defineConfig({
  plugins: [preact(), alphaTab()],
})
