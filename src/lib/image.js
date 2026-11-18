/**
 * Shrinks a phone screenshot before upload: long side at most `maxSide` px, saved as JPEG.
 * A 1080×2400 PNG (~1.5 MB) usually ends up around 200–350 KB and stays readable.
 */
export async function compressImage(file, { maxSide = 1800, quality = 0.85 } = {}) {
  if (!file || !/^image\//.test(file.type)) {
    throw new Error('That file is not an image. Choose a PNG or JPG screenshot.')
  }
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('That image could not be opened. Try another screenshot.'))
      el.src = url
    })
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight))
    const w = Math.round(img.naturalWidth * scale)
    const h = Math.round(img.naturalHeight * scale)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff' // transparent PNG areas would turn black in JPEG
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(img, 0, 0, w, h)
    return canvas.toDataURL('image/jpeg', quality)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** First image found in a paste or drop event, if any. */
export function imageFromTransfer(dt) {
  if (!dt) return null
  for (const item of dt.items || []) {
    if (item.kind === 'file' && item.type.startsWith('image/')) return item.getAsFile()
  }
  for (const f of dt.files || []) {
    if (f.type.startsWith('image/')) return f
  }
  return null
}
