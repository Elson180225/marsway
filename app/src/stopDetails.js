// Shared stop metadata contract: photo_url, photo_credit, photo_source_url,
// photo_caption, photo_view ('nearby' when appropriate), sol and camera.
// No images or science locations are fabricated by this component.
export function mediaUrl(value, base) {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const url = new URL(value, base)
    const origin = new URL(base)
    if (url.username || url.password) return null
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.origin === origin.origin)) return null
    return url.href
  } catch {
    return null
  }
}

export function stopMetadata(stop, base) {
  const point = (value) => Number.isFinite(value?.x) && Number.isFinite(value?.y)
    ? `x ${value.x.toFixed(1)} m, y ${value.y.toFixed(1)} m` : 'Coordinates unavailable'
  const label = (value) => value === null || value === undefined || String(value).trim() === '' ? null : String(value)
  return {
    name: label(stop.name) || 'Selected stop',
    description: label(stop.description) || 'Science description pending.',
    coordinates: point(stop),
    original: stop.original ? point(stop.original) : null,
    moved: Number.isFinite(stop.moved_m) && stop.moved_m > 0 ? stop.moved_m : null,
    photo: mediaUrl(stop.photo_url, base),
    source: mediaUrl(stop.photo_source_url, base),
    credit: label(stop.photo_credit),
    caption: label(stop.photo_caption),
    nearby: stop.photo_view === 'nearby',
    sol: label(stop.sol),
    camera: label(stop.camera),
    visitMinutes: Number.isFinite(stop.stop_minutes) && stop.stop_minutes >= 0 ? stop.stop_minutes : null,
    bonus: stop.is_bonus === true,
  }
}

export function renderStopDetails(container, stop, { targetStatus = 'pending' } = {}) {
  const meta = stopMetadata(stop, window.location.href)
  const element = (tag, className, text) => {
    const node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined) node.textContent = text
    return node
  }
  const card = element('article', 'science-card')
  const heading = element('div', 'science-heading')
  const title = element('div')
  title.append(element('span', 'eyebrow', 'SELECTED STOP'), element('h2', '', meta.name))
  heading.append(title)
  if (targetStatus !== 'ready' && stop.type !== 'home' && stop.type !== 'habitat') {
    heading.append(element('span', 'science-badge', 'DEMO TARGET'))
  } else if (meta.bonus) {
    heading.append(element('span', 'science-badge science-bonus', 'OPTIONAL BONUS STOP'))
  }
  const displayDescription = stop.type === 'habitat' ? (stop.name === 'Habitat (H1)' ? 'Habitat H1: flat ground, crew base.' : stop.description) : meta.description
  const firstSentence = displayDescription.match(/^[\s\S]*?[.!?](?=\s|$)/)?.[0] || displayDescription
  const description = element('p', 'science-description science-preview', firstSentence)
  card.append(heading, description)
  if (firstSentence !== displayDescription) {
    const more = element('details', 'science-more')
    more.append(element('summary', '', 'More about this stop'), element('p', '', displayDescription))
    card.append(more)
  }
  card.append(element('p', 'science-coordinates', meta.coordinates))
  if (meta.visitMinutes !== null) card.append(element('p', 'science-visit', `${meta.visitMinutes} min science${meta.bonus ? ' · Optional, check return time' : ''}`))
  if (meta.moved) {
    card.append(element('p', 'science-moved', `Route stop relocated ${meta.moved} m onto reachable terrain. Original: ${meta.original || 'coordinates unavailable'}.`))
  }
  if (meta.photo) {
    const figure = element('figure', 'science-figure')
    const image = element('img', 'science-photo')
    image.alt = meta.caption || `${meta.nearby ? 'Nearby view of' : 'View associated with'} ${meta.name}`
    image.loading = 'lazy'
    image.decoding = 'async'
    image.referrerPolicy = 'no-referrer'
    const photoStatus = element('p', 'science-photo-status', 'Loading photo...')
    photoStatus.setAttribute('role', 'status')
    image.addEventListener('load', () => { photoStatus.hidden = true }, { once: true })
    image.addEventListener('error', () => {
      if (!container.contains(card)) return
      image.hidden = true
      photoStatus.hidden = false
      photoStatus.textContent = 'Photo could not load. Check its file path or open the image source below.'
    }, { once: true })
    const caption = element('figcaption', 'science-caption')
    if (meta.nearby) caption.append(element('strong', 'science-nearby', 'Nearby view - not an exact stop photograph.'))
    if (meta.caption) {
      const photoMore = element('details', 'science-photo-more')
      photoMore.append(element('summary', '', 'Photo details'), element('p', '', meta.caption))
      caption.append(photoMore)
    }
    const camera = [meta.sol !== null ? `Sol ${meta.sol}` : null, meta.camera].filter(Boolean).join(' | ')
    if (camera) caption.append(element('p', '', camera))
    caption.append(element('p', '', meta.credit ? `Image credit: ${meta.credit}` : 'Image credit pending - add photo_credit before presentation.'))
    const link = element('a', 'science-source', meta.source ? 'Open original source' : 'Open image')
    link.href = meta.source || meta.photo
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
    caption.append(link)
    figure.append(image, photoStatus, caption)
    card.append(figure)
    // Set src only after listeners exist, including for already-cached images.
    image.src = meta.photo
  } else if (stop.type !== 'habitat' && stop.type !== 'home') {
    card.append(element('div', 'science-photo-empty', 'Photo pending. Kelly can add photo_url, photo_credit and the source details for this stop.'))
  }
  container.replaceChildren(card)
}
