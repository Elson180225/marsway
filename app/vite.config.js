import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

// Two pages: the Planning screen (index.html) and the phone Walk screen (walk.html).
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        walk: fileURLToPath(new URL('./walk.html', import.meta.url)),
      },
    },
  },
})
