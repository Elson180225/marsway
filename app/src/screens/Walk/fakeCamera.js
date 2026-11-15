// Simulated camera for the demo, like the Android emulator's camera: "📷 Take photo" opens a camera
// screen showing a made-up Mars landscape (marsScene.js) that drifts a little, as if hand-held. The
// shutter button keeps what is in view as a JPEG. Works the same on a laptop and in the Android app.
// The real camera code stays in main.js: set REAL_CAMERA there to switch it back on.
//
//   openFakeCamera({ seed, label, onShot })   onShot(blob) after the shutter, then the camera closes.
//   Closes with ✕, Escape or the phone's back button (it adds a history entry while open).
import { drawMarsScene } from './marsScene.js'

const MARGIN = 0.1 // the scene is drawn 10% bigger on each side, so the view can drift
const MAX_SCALE = 2 // device pixels per CSS pixel, at most

export function openFakeCamera({ seed, label = '', onShot }) {
  const opener = document.activeElement
  const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const box = document.createElement('div')
  box.className = 'walk-cam'
  box.setAttribute('role', 'dialog')
  box.setAttribute('aria-modal', 'true')
  box.setAttribute('aria-label', 'Camera (simulated)')
  box.innerHTML = `
    <div class="walk-cam-view"><canvas></canvas><div class="walk-cam-grid" aria-hidden="true"></div>
      <span class="walk-cam-chip">Simulated camera${label ? ` · ${label.replace(/[<>&"]/g, '')}` : ''}</span></div>
    <div class="walk-cam-bar">
      <button type="button" class="walk-cam-close" aria-label="Close the camera">✕</button>
      <button type="button" class="walk-cam-shutter" aria-label="Take the photo"><span></span></button>
      <span></span>
    </div>`
  document.body.append(box)
  const canvas = box.querySelector('canvas')
  const view = canvas.getContext('2d')

  // Draw the whole scene once, a bit bigger than the view; each frame shows part of it.
  const rect = box.querySelector('.walk-cam-view').getBoundingClientRect()
  const scale = Math.min(MAX_SCALE, window.devicePixelRatio || 1)
  canvas.width = Math.max(1, Math.round(rect.width * scale))
  canvas.height = Math.max(1, Math.round(rect.height * scale))
  const scene = document.createElement('canvas')
  scene.width = Math.round(canvas.width * (1 + 2 * MARGIN))
  scene.height = Math.round(canvas.height * (1 + 2 * MARGIN))
  drawMarsScene(scene.getContext('2d'), scene.width, scene.height, seed)

  let frame = 0
  const started = performance.now()
  function draw(now) {
    const t = still ? 0 : (now - started) / 1000
    const sway = (a, b) => Math.sin(t * a) * 0.6 + Math.sin(t * b) * 0.4 // -1 … 1, slow and uneven
    const x = canvas.width * MARGIN * (1 + 0.5 * sway(0.7, 1.9))
    const y = canvas.height * MARGIN * (1 + 0.35 * sway(0.9, 1.3))
    view.drawImage(scene, x, y, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height)
    if (!still) frame = requestAnimationFrame(draw)
  }
  draw(started)

  let open = true
  let busy = false
  function close() {
    if (!open) return
    open = false
    cancelAnimationFrame(frame)
    window.removeEventListener('popstate', close)
    document.removeEventListener('keydown', onKey)
    box.remove()
    opener?.focus?.({ preventScroll: true })
  }
  const leave = () => { if (open) history.back() } // pops our history entry, which closes the camera
  const onKey = (event) => { if (event.key === 'Escape') leave() }
  history.pushState({ walkCamera: true }, '')
  window.addEventListener('popstate', close)
  document.addEventListener('keydown', onKey)

  box.querySelector('.walk-cam-close').addEventListener('click', leave)
  box.querySelector('.walk-cam-shutter').addEventListener('click', () => {
    if (busy) return
    busy = true
    canvas.toBlob(async (blob) => {
      try { if (blob) await onShot(blob) } finally { setTimeout(leave, 250) } // let the flash show first
    }, 'image/jpeg', 0.88)
  })
  box.querySelector('.walk-cam-shutter').focus({ preventScroll: true })
  return { close: leave }
}
