// Copies the single-file build into apps-script/Index.html, ready to paste into Apps Script.
import { copyFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const from = fileURLToPath(new URL('../dist/index.html', import.meta.url))
const to = fileURLToPath(new URL('../apps-script/Index.html', import.meta.url))

copyFileSync(from, to)
console.log(`apps-script/Index.html written (${Math.round(statSync(to).size / 1024)} KB)`)
