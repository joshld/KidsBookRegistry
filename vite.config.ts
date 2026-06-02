import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { googleTokenApiPlugin } from './vite-plugin-google-token'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [react(), tailwindcss(), googleTokenApiPlugin(env)],
    server: {
      allowedHosts: true,
    },
  }
})
