import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import process from 'node:process'
import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

// Link-preview crawlers (Facebook, Viber, Telegram, TikTok...) only accept absolute image URLs, so
// index.html's __SITE_URL__ is replaced with the site's address at build time: SITE_URL if set
// (e.g. a custom domain), otherwise the production domain Vercel provides during its builds.
function siteUrl() {
  const url = process.env.SITE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL && `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`) || ''
  return {
    name: 'site-url',
    transformIndexHtml: (html) => html.replaceAll('__SITE_URL__', url.replace(/\/+$/, '')),
  }
}

// The build is a single self-contained index.html, because an Apps Script web app
// can only serve HTML files (no separate JS/CSS assets).
export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile(), siteUrl()],
})
