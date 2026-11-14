// Labels, sources and interpretation match Kelly's checked-in orbital sidecars.
export const scienceLayerInfo = {
  ctx: {
    title: 'CTX orbital photo',
    detail: 'Uncontrolled CTX mosaic; about 5 m source pixels. Registration to the terrain DEM is unverified. Offsets of tens of metres or more are possible; matching crop bounds do not prove alignment.',
    credit: 'NASA/JPL/MSSS/The Murray Lab (Caltech); tiles hosted by Esri.',
    source: 'https://murray-lab.caltech.edu/CTX/',
    sourceLabel: 'CTX mosaic source',
  },
  crismHyd: {
    title: 'CRISM hydrated-mineral signals (HYD)',
    detail: '2012 prototype browse mosaic, about 19 m source pixels. Colours show qualitative spectral signals, not mineral percentages or individual ridges. Blank areas can mean dust, weak signal or missing coverage. Alignment to the terrain DEM has not been independently verified.',
    credit: 'NASA/JPL/JHUAPL; mosaics by F. Seelos, K. Seelos and C. Viviano (CRISM team).',
    source: 'http://crism.jhuapl.edu/msl_landing_sites/2012July_Mosaics/HYD/MSL_gale_crater_targeted_mosaic_HYD_120723.png',
    sourceLabel: 'CRISM HYD source image',
    key: [
      { colour: '#bad733', label: 'Green/yellow: monohydrated sulfate signals' },
      { colour: '#c068b9', label: 'Magenta: polyhydrated sulfate signals' },
      { colour: '#679bd5', label: 'Blue: other hydrated signals' },
    ],
  },
  crismAlt: {
    title: 'CRISM alteration signals (ALT)',
    detail: '2012 prototype browse mosaic, about 19 m source pixels. Colours show qualitative spectral signals, not mineral percentages or individual ridges. Blank areas can mean dust, weak signal or missing coverage. Alignment to the terrain DEM has not been independently verified.',
    credit: 'NASA/JPL/JHUAPL; mosaics by F. Seelos, K. Seelos and C. Viviano (CRISM team).',
    source: 'http://crism.jhuapl.edu/msl_landing_sites/2012July_Mosaics/ALT/MSL_gale_crater_targeted_mosaic_ALT_120723.png',
    sourceLabel: 'CRISM ALT source image',
    key: [
      { colour: '#57b895', label: 'Green/blue-green: sulfate signals' },
      { colour: '#d57965', label: 'Red: Fe/Mg clay signals' },
    ],
  },
  themis: {
    title: 'THEMIS relative night IR brightness',
    detail: 'About 163 m source pixels: only about 18 span this 3 km area. This multi-observation mosaic is relative night infrared brightness, not calibrated temperature, thermal inertia, current weather or reliable material classification. Fine relief visible under the translucent image comes from the terrain basemap, not THEMIS.',
    credit: 'NASA/JPL-Caltech/Arizona State University; tiles from NASA Mars Trek.',
    source: 'https://trek.nasa.gov/mars/',
    sourceLabel: 'NASA Mars Trek source',
  },
}

export function showScienceLayerInfo(container, key, failed = false) {
  const element = (tag, className, value) => {
    const node = document.createElement(tag)
    if (className) node.className = className
    if (value !== undefined) node.textContent = value
    return node
  }
  if (!key) {
    container.textContent = 'Orbital layers: select to see legend, credit and source.'
    return
  }
  const info = scienceLayerInfo[key]
  if (!info) throw new Error(`Unknown science layer: ${key}`)
  const card = element('div', 'science-layer-info')
  card.append(element('strong', '', info.title))
  if (failed) card.append(element('p', 'science-layer-error', `Could not load the ${info.title} image. Check the local file in public/terrain/.`))
  const firstSentence = info.detail.match(/^[\s\S]*?[.!?](?=\s|$)/)?.[0] || info.detail
  card.append(element('p', '', firstSentence))
  if (info.key) {
    const legend = element('ul', 'science-colour-key')
    for (const item of info.key) {
      const row = element('li')
      const swatch = element('span', 'science-swatch')
      swatch.style.backgroundColor = item.colour
      row.append(swatch, document.createTextNode(item.label))
      legend.append(row)
    }
    card.append(legend)
  }
  card.append(element('p', 'science-credit', `Image credit: ${info.credit}`))
  const source = element('a', 'science-source', `Open original source: ${info.sourceLabel}`)
  source.href = info.source
  source.target = '_blank'
  source.rel = 'noopener noreferrer'
  card.append(source)
  const more = element('details', 'science-layer-more')
  more.append(element('summary', '', 'About this layer ⓘ'), element('p', '', info.detail))
  card.append(more)
  container.replaceChildren(card)
}
