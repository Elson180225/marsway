// A made-up Mars landscape for the simulated camera, like the Android emulator's pretend camera scene:
// butterscotch sky, layered hills on the horizon, rusty ground with pebbles and rocks. Not a real place
// and not a NASA image. The same seed always draws the same view, so each science stop has its own.
//
//   drawMarsScene(ctx, width, height, seed)   draws on a canvas 2D context
//   seedFromText('EVA-07:boxwork-lookout')    -> a whole-number seed for that text
import { makeRandom } from '../../safezone/randomEvents.js'

export function seedFromText(text) {
  let hash = 2166136261 // FNV-1a
  for (const char of String(text)) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619) }
  return hash >>> 0
}

export function drawMarsScene(ctx, width, height, seed) {
  const random = makeRandom(seed)
  const between = (low, high) => low + random() * (high - low)
  const horizon = height * between(0.34, 0.42)

  // Sky: darker overhead, pale and dusty at the horizon.
  const sky = ctx.createLinearGradient(0, 0, 0, horizon)
  sky.addColorStop(0, '#9c7254')
  sky.addColorStop(0.65, '#d1a57e')
  sky.addColorStop(1, '#e9caa5')
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, width, horizon + 4)

  // A ridge line: a few smooth waves added together.
  const ridge = (base, amp, waves) => {
    const parts = waves.map((cycles) => ({ cycles, phase: between(0, Math.PI * 2), weight: between(0.5, 1.5) }))
    const total = parts.reduce((sum, part) => sum + part.weight, 0)
    return (x) => base - amp * parts.reduce((sum, p) => sum + p.weight * Math.sin((x / width) * p.cycles * Math.PI * 2 + p.phase), 0) / total
  }
  const fillBelow = (line, fill) => {
    ctx.beginPath()
    ctx.moveTo(0, height)
    for (let x = 0; x <= width; x += 4) ctx.lineTo(x, line(x))
    ctx.lineTo(width, height)
    ctx.closePath()
    ctx.fillStyle = fill
    ctx.fill()
  }

  // Far mountain with faint layers in its rock (like Mount Sharp), then nearer, darker ridges.
  const far = ridge(horizon - height * 0.03, height * between(0.07, 0.13), [0.5, 1.2, 2.6, 5.3])
  fillBelow(far, '#c39672')
  ctx.save()
  ctx.clip()
  ctx.globalAlpha = 0.06
  for (let y = horizon - height * 0.2; y < horizon + height * 0.05; y += height * between(0.008, 0.016)) {
    ctx.fillStyle = random() < 0.5 ? '#f3d6b4' : '#8f6247'
    ctx.fillRect(0, y, width, height * 0.004)
  }
  ctx.restore()
  fillBelow(ridge(horizon + height * 0.01, height * 0.03, [0.9, 1.7, 3.3]), '#ad6d45')
  const near = ridge(horizon + height * 0.06, height * 0.015, [0.7, 1.6, 3.1])
  const ground = ctx.createLinearGradient(0, horizon, 0, height)
  ground.addColorStop(0, '#a5633b')
  ground.addColorStop(1, '#6b3720')
  fillBelow(near, ground)

  // Dust haze along the horizon.
  const haze = ctx.createLinearGradient(0, horizon - height * 0.08, 0, horizon + height * 0.08)
  haze.addColorStop(0, 'rgba(233, 202, 165, 0)')
  haze.addColorStop(0.5, 'rgba(233, 202, 165, 0.35)')
  haze.addColorStop(1, 'rgba(233, 202, 165, 0)')
  ctx.fillStyle = haze
  ctx.fillRect(0, horizon - height * 0.08, width, height * 0.16)

  // Pebbles and grit: smaller towards the horizon.
  const depth = () => random() ** 0.8 // 0 = horizon, 1 = at the camera
  for (let k = 0; k < 2600; k++) {
    const d = depth()
    const x = random() * width
    const y = near(x) + d * (height - near(x))
    const size = (0.6 + d * 5) * (width / 1000) * between(0.5, 1.4)
    ctx.fillStyle = random() < 0.55 ? `rgba(70, 34, 18, ${between(0.2, 0.5)})` : `rgba(214, 150, 104, ${between(0.15, 0.45)})`
    ctx.beginPath()
    ctx.ellipse(x, y, size, size * 0.6, 0, 0, Math.PI * 2)
    ctx.fill()
  }

  // Rocks, far ones first: lit from the upper left, with a shadow on the ground.
  const rocks = Array.from({ length: Math.round(between(12, 20)) }, () => {
    const d = depth()
    const x = random() * width
    return { x, d, y: near(x) + d * (height - near(x)), r: (0.012 + d * d * 0.14) * width * between(0.6, 1.3) }
  }).sort((a, b) => a.y - b.y)
  for (const rock of rocks) {
    ctx.fillStyle = 'rgba(40, 18, 8, 0.35)'
    ctx.beginPath()
    ctx.ellipse(rock.x + rock.r * 0.35, rock.y + rock.r * 0.12, rock.r * 1.1, rock.r * 0.28, 0, 0, Math.PI * 2)
    ctx.fill()
    const points = Math.round(between(7, 10))
    ctx.beginPath()
    for (let p = 0; p < points; p++) {
      const angle = Math.PI + (p / (points - 1)) * Math.PI // the top half: rocks sit on the ground
      const radius = rock.r * between(0.75, 1.15)
      const px = rock.x + Math.cos(angle) * radius
      const py = rock.y + Math.sin(angle) * radius * between(0.45, 0.7)
      if (p === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py)
    }
    ctx.closePath()
    const shade = ctx.createLinearGradient(rock.x - rock.r, rock.y - rock.r * 0.6, rock.x + rock.r, rock.y)
    shade.addColorStop(0, '#c07f52')
    shade.addColorStop(0.55, '#7d4426')
    shade.addColorStop(1, '#4a2414')
    ctx.fillStyle = shade
    ctx.fill()
  }

  // Lens vignette.
  const vignette = ctx.createRadialGradient(width / 2, height / 2, Math.min(width, height) * 0.35, width / 2, height / 2, Math.hypot(width, height) * 0.6)
  vignette.addColorStop(0, 'rgba(0, 0, 0, 0)')
  vignette.addColorStop(1, 'rgba(0, 0, 0, 0.35)')
  ctx.fillStyle = vignette
  ctx.fillRect(0, 0, width, height)
}
