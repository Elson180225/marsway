// MarsWay Planning: 3D view of the 6 km map (same data, route and stops as the 2D map)
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

const DEFAULT_ALPHA = { slope: 0.55, roughness: 0.7, ctx: 0.85, crismHyd: 0.7, crismAlt: 0.7, themis: 0.75, safety: 0.6 }
const loadImage = (src) => new Promise((resolve, reject) => {
  const img = new Image(); img.crossOrigin = 'anonymous'; img.onload = () => resolve(img); img.onerror = reject; img.src = src
})

export function webglAvailable() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')) } catch { return false }
}

/**
 * grid: the terrain grid Planning already loads (makeGrid result)
 * basemapUrl: e.g. '/terrain/basemap.webp'
 * layers: { slope: { url }, roughness: { url }, ctx: { url, bounds: { x0, y0, x1, y1 } }, ... }  (local metres)
 * legs: [{ path: [{ x, y }, ...] }], returnPath: [{ x, y }], stops: [{ x, y, name }]
 * onSelectStop(index): called when a stop pin is clicked
 */
export function createPlanning3D(container, opts) {
  const { grid, basemapUrl, layers = {}, onSelectStop = () => {}, meshSize = 300 } = opts
  let { legs = [], stops = [], returnPath = [] } = opts
  let ex = opts.exaggeration ?? 1.5, selected = -1, activeLayers = [], baseVisible = true
  const SX = grid.sizeX, SY = grid.sizeY

  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  Object.assign(renderer.domElement.style, { display: 'block', width: '100%', height: '100%' })
  container.appendChild(renderer.domElement)
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x10151c)
  const camera = new THREE.PerspectiveCamera(42, 1, 10, 100000)
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true; controls.maxPolarAngle = Math.PI * 0.48; controls.minDistance = 250; controls.maxDistance = 16000
  scene.add(new THREE.AmbientLight(0xffffff, 0.65))
  const sun = new THREE.DirectionalLight(0xfff1e0, 0.7); sun.position.set(-4000, 6000, -3000); scene.add(sun)

  // terrain mesh (grid row 0 = north edge)
  const n = Math.min(meshSize, grid.width)
  let zmin = Infinity; for (const v of grid.elevation) if (v < zmin) zmin = v
  const heights = new Float32Array(n * n)
  for (let i = 0; i < n; i++) {
    const row = Math.round(i * (grid.height - 1) / (n - 1))
    for (let j = 0; j < n; j++) heights[i * n + j] = grid.elevation[row * grid.width + Math.round(j * (grid.width - 1) / (n - 1))] - zmin
  }
  const geo = new THREE.PlaneGeometry(SX, SY, n - 1, n - 1); geo.rotateX(-Math.PI / 2)
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 2048
  const ctx2d = canvas.getContext('2d')
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy()
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: texture })); scene.add(mesh)

  function heightAt(x, y) {
    const w = grid.width, e = grid.elevation
    const fx = Math.min(w - 1.001, Math.max(0, x / grid.cellSize - 0.5)), fy = Math.min(grid.height - 1.001, Math.max(0, (SY - y) / grid.cellSize - 0.5))
    const c0 = Math.floor(fx), r0 = Math.floor(fy), tx = fx - c0, ty = fy - r0, g = (c, r) => e[r * w + c]
    return ((g(c0, r0) * (1 - tx) + g(c0 + 1, r0) * tx) * (1 - ty) + (g(c0, r0 + 1) * (1 - tx) + g(c0 + 1, r0 + 1) * tx) * ty) - zmin
  }
  const toWorld = (p, lift = 0) => new THREE.Vector3(p.x - SX / 2, heightAt(p.x, p.y) * ex + lift, -(p.y - SY / 2))

  // Compose the same enabled overlays as the 2D map, in the same order.
  const images = new Map()
  let paintId = 0
  const imageFor = (url) => {
    if (!images.has(url)) images.set(url, loadImage(url).catch((error) => { images.delete(url); throw error }))
    return images.get(url)
  }
  async function paint() {
    const id = ++paintId
    const selected = activeLayers.map((name) => [name, layers[name]]).filter(([, layer]) => layer)
    try {
      const base = baseVisible ? await imageFor(basemapUrl) : null
      const overlays = await Promise.all(selected.map(async ([name, layer]) => [name, layer, await imageFor(layer.url)]))
      if (id !== paintId) return
      ctx2d.globalAlpha = 1
      ctx2d.fillStyle = '#26333a'
      ctx2d.fillRect(0, 0, canvas.width, canvas.height)
      if (base) ctx2d.drawImage(base, 0, 0, canvas.width, canvas.height)
      for (const [name, layer, img] of overlays) {
        const b = layer.bounds || { x0: 0, y0: 0, x1: SX, y1: SY }, px = canvas.width / SX, py = canvas.height / SY
        ctx2d.globalAlpha = layer.opacity ?? DEFAULT_ALPHA[name] ?? 0.7
        ctx2d.drawImage(img, b.x0 * px, (SY - b.y1) * py, (b.x1 - b.x0) * px, (b.y1 - b.y0) * py)
      }
      ctx2d.globalAlpha = 1
      texture.needsUpdate = true
    } catch (error) {
      console.error('Could not paint Planning 3D terrain layer:', error)
    }
  }

  // route, return path and stop pins
  const group = new THREE.Group(); scene.add(group); const pins = []
  function tube(points, color, radius) {
    if (!points || points.length < 2) return null
    const curve = new THREE.CatmullRomCurve3(points.map((p) => toWorld(p, 6)))
    return new THREE.Mesh(new THREE.TubeGeometry(curve, Math.min(2000, points.length * 2), radius, 6, false), new THREE.MeshBasicMaterial({ color }))
  }
  function label(text, color) {
    const c = document.createElement('canvas'), g = c.getContext('2d'); g.font = 'bold 34px Segoe UI, sans-serif'
    c.width = Math.ceil(g.measureText(text).width) + 24; c.height = 52; g.font = 'bold 34px Segoe UI, sans-serif'
    g.fillStyle = 'rgba(10,8,7,.78)'; g.fillRect(0, 0, c.width, c.height); g.fillStyle = color; g.fillText(text, 12, 38)
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }))
    s.scale.set(c.width * 2.4, c.height * 2.4, 1); s.renderOrder = 10; return s
  }
  function drawOverlays() {
    group.traverse((o) => { o.geometry?.dispose?.(); o.material?.map?.dispose?.(); o.material?.dispose?.() })
    group.clear(); pins.length = 0
    legs.forEach((leg) => { const t = tube(leg.path, 0xf6b77c, 7); if (t) group.add(t) })
    const r = tube(returnPath, 0x8ce0d6, 5); if (r) group.add(r)
    stops.forEach((s, i) => {
      const base = toWorld(s), color = i === selected ? 0xffffff : 0xf0b38f
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 110, 8), new THREE.MeshBasicMaterial({ color }))
      pole.position.copy(base).add(new THREE.Vector3(0, 55, 0))
      const head = new THREE.Mesh(new THREE.SphereGeometry(i === selected ? 30 : 22, 16, 12), new THREE.MeshBasicMaterial({ color }))
      head.position.copy(base).add(new THREE.Vector3(0, 120, 0)); head.userData.index = i
      const tag = label(s.name || `Stop ${i}`, i === selected ? '#ffffff' : '#ffd7bd'); tag.position.copy(base).add(new THREE.Vector3(0, 200, 0))
      group.add(pole, head, tag); pins.push(head)
    })
  }
  function applyHeights() {
    const pos = geo.attributes.position
    for (let i = 0; i < pos.count; i++) pos.setY(i, heights[i] * ex)
    pos.needsUpdate = true; geo.computeVertexNormals(); geo.computeBoundingSphere(); drawOverlays()
  }

  // clicking a stop pin
  const ray = new THREE.Raycaster(), mouse = new THREE.Vector2(); let down = null
  renderer.domElement.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY] })
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return
    const rect = renderer.domElement.getBoundingClientRect()
    mouse.set((e.clientX - rect.left) / rect.width * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1)
    ray.setFromCamera(mouse, camera); const hit = ray.intersectObjects(pins)[0]
    if (hit) onSelectStop(hit.object.userData.index)
  })

  function resetView() {
    const c = stops.length ? stops.reduce((a, s) => ({ x: a.x + s.x / stops.length, y: a.y + s.y / stops.length }), { x: 0, y: 0 }) : { x: SX / 2, y: SY / 2 }
    const t = toWorld(c); controls.target.copy(t); camera.position.set(t.x - 1800, t.y + 2600, t.z + 2600); controls.update()
  }

  const ro = new ResizeObserver(() => {
    const w = container.clientWidth || 1, h = container.clientHeight || 1
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix()
  }); ro.observe(container)
  let running = true
  ;(function loop() { if (!running) return; controls.update(); renderer.render(scene, camera); requestAnimationFrame(loop) })()

  applyHeights(); paint(); resetView()
  return {
    setLayers(names, showBase = true) { activeLayers = [...names]; baseVisible = showBase; return paint() },
    setLayer(name) { activeLayers = name === 'terrain' ? [] : [name]; baseVisible = true; return paint() },
    setExaggeration(v) { ex = v; applyHeights() },
    setRoute(next) { legs = next.legs ?? legs; stops = next.stops ?? stops; returnPath = next.returnPath ?? returnPath; selected = -1; drawOverlays(); resetView() },
    setReturnPath(path) { returnPath = path || []; drawOverlays() },
    select(index) { selected = index; drawOverlays(); if (stops[index]) controls.target.copy(toWorld(stops[index])) },
    resetView,
    dispose() { running = false; ro.disconnect(); renderer.dispose(); renderer.domElement.remove() },
  }
}
