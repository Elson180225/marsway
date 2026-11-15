// Simulated camera for the demo. "📷 Take photo" makes a photo from a NASA image of the stop (Kelly's
// photo for that stop), framed a little differently each time, as if the astronaut had just taken it.
// It works the same on a laptop and in the Android app. The real camera code stays in main.js:
// set REAL_CAMERA there to switch it back on.
//
//   simulatedPhoto([{ url, credit }, …])  -> { blob, credit } from the first image that loads (JPEG)

// Used when the stop has no photo of its own (or it can't load). Public NASA image, credited.
export const SAMPLE_FALLBACK = { url: '/photos/boxwork-lookout.jpg', credit: 'NASA/JPL-Caltech' }

const MAX_WIDTH = 1600

export async function simulatedPhoto(sources, random = Math.random) {
  for (const source of sources) {
    if (!source?.url) continue
    try { return { blob: await reframe(source.url, random), credit: source.credit || null } }
    catch { /* try the next image */ }
  }
  throw new Error('No sample photo could load.')
}

// Keeps 78–90% of the picture at a random spot, so no two photos look exactly alike.
async function reframe(url, random) {
  const image = new Image()
  image.src = url
  await image.decode()
  const zoom = 0.78 + random() * 0.12
  const sw = image.naturalWidth * zoom
  const sh = image.naturalHeight * zoom
  const sx = random() * (image.naturalWidth - sw)
  const sy = random() * (image.naturalHeight - sh)
  const width = Math.min(MAX_WIDTH, Math.round(sw))
  const height = Math.round((width * sh) / sw)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.getContext('2d').drawImage(image, sx, sy, sw, sh, 0, 0, width, height)
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not make the photo.'))), 'image/jpeg', 0.86)
  })
}
