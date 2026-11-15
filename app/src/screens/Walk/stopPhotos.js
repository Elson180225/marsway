// Photos the crew takes at a science stop, kept on this device only (IndexedDB). Nothing is uploaded.
// Each photo is saved with the EVA, the stop, the simulated mission time and the simulated position.
//
//   savePhoto({ blob, eva, stopId, stopName, simTimeMs, position, sampleCredit })  -> the saved record
//   photosFor(eva, stopId)                                            -> records, oldest first
//   photoFileName(record)                                             -> "MarsWay_EVA-07_boxwork-lookout_08-49-12.jpg"
//
// A record: { id, blob, type, eva, stopId, stopName, simTimeMs, takenAtMs, position: { x, y } | null,
//             sampleCredit: 'NASA/JPL-Caltech' | null }  (sampleCredit: a simulated photo made from that image)

const DB_NAME = 'marsway-stop-photos'
const STORE = 'photos'

let opening = null
function db() {
  opening ??= new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('This browser cannot save photos.')); return }
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true })
      store.createIndex('byStop', ['eva', 'stopId'])
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Could not open photo storage.'))
  }).catch((error) => { opening = null; throw error })
  return opening
}

function run(mode, work) {
  return db().then((database) => new Promise((resolve, reject) => {
    const tx = database.transaction(STORE, mode)
    const request = work(tx.objectStore(STORE))
    tx.oncomplete = () => resolve(request.result)
    tx.onerror = () => reject(tx.error ?? new Error('Photo storage failed.'))
    tx.onabort = () => reject(tx.error ?? new Error('Photo storage is full or blocked.'))
  }))
}

export async function savePhoto({ blob, eva, stopId, stopName, simTimeMs, position = null, sampleCredit = null }) {
  if (!(blob instanceof Blob) || !blob.size) throw new Error('No photo to save.')
  const record = {
    blob, type: blob.type || 'image/jpeg', eva, stopId, stopName, simTimeMs, takenAtMs: Date.now(),
    position: position && Number.isFinite(position.x) && Number.isFinite(position.y) ? { x: position.x, y: position.y } : null,
    sampleCredit: typeof sampleCredit === 'string' && sampleCredit ? sampleCredit : null,
  }
  const id = await run('readwrite', (store) => store.add(record))
  return { ...record, id }
}

export async function photosFor(eva, stopId) {
  const list = await run('readonly', (store) => store.index('byStop').getAll([eva, stopId]))
  return list.sort((a, b) => a.simTimeMs - b.simTimeMs || a.id - b.id)
}

const EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif' }

export function photoFileName(record) {
  const slug = (text) => String(text ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'stop'
  const time = new Date(record.simTimeMs).toISOString().slice(11, 19).replaceAll(':', '-')
  return `MarsWay_${slug(record.eva).toUpperCase()}_${slug(record.stopName)}_${time}.${EXTENSIONS[record.type] ?? 'jpg'}`
}
