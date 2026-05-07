import { defineConfig } from 'vite'

export default defineConfig({
  base: '/midi-translator/',
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts']
  }
})
