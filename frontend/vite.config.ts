import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// In browser dev mode the UI talks to cmd/devserver. Proxying keeps it
// same-origin, so there is no CORS handling to get wrong.
const apiProxy = {
  '/api': {
    target: 'http://127.0.0.1:34567',
    changeOrigin: false,
  },
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: apiProxy,
  },
  // `vite preview` serves the production bundle; it needs the same proxy, or
  // checking a real build against the real API means running Wails.
  preview: {
    port: 4173,
    proxy: apiProxy,
  },
  build: {
    // Wails embeds this directory via go:embed.
    outDir: 'dist',
    // Clean each build, or stale hashed bundles pile up and every one of
    // them gets embedded into the binary. The tracked .gitkeep that main.go's
    // go:embed depends on is restored by the build script afterwards.
    emptyOutDir: true,
  },
})
