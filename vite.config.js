import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

// The build is a single self-contained index.html, because an Apps Script web app
// can only serve HTML files (no separate JS/CSS assets).
export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
})
