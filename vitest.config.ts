import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '#pdfkit-browser': fileURLToPath(
        new URL('./node_modules/pdfkit/js/pdfkit.browser.mjs', import.meta.url),
      ),
    },
  },
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    environment: 'node',
    coverage: {
      reporter: ['text', 'html'],
    },
  },
})
