/**
 * @local/dsh-time-ledger — Host half.
 *
 * The browser half owns activity detection and the live counter. This half
 * owns durable storage: one exact JSON endpoint under the local Web server.
 * Data lives in the workspace's dstime_data folder so it is easy to find,
 * back up and move independently of the DSH profile.
 */
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const inject = ['webServer']

const ROUTE = '/dsh-time-ledger/state'
const MAX_BODY_BYTES = 4 * 1024 * 1024
const MAX_SESSIONS = 20000
const MAX_DAYS_PER_SESSION = 3700
const MAX_DAY_MS = 3 * 24 * 60 * 60 * 1000
const MAX_SESSION_MS = 20 * 365 * 24 * 60 * 60 * 1000
const MIN_RECORD_MS = 60 * 1000
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/

const DATA_DIR = process.env.DSTIME_DATA_DIR || join('D:/dsh_common', 'dstime_data')
const DATA_FILE = join(DATA_DIR, 'time-ledger.json')
const LEGACY_DATA_FILE = join(
  process.env.DSH_PROFILE_DIR
    || join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'profiles', process.env.DSH_PROFILE || 'desktop'),
  'time-ledger.json'
)
const DATA_VERSION = 1

/** Serialize writers so two rapid saves cannot lose one another. */
let writeQueue = Promise.resolve()

function enqueueWrite(task) {
  const next = writeQueue.then(task, task)
  writeQueue = next.catch(() => {})
  return next
}

function emptyStore() {
  return { version: DATA_VERSION, updatedAt: Date.now(), sessions: [] }
}

function isFiniteNonNegative(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function clampNumber(value, max) {
  return Math.min(Math.round(value), max)
}

/**
 * Accept only the shape the client owns. Unknown fields are dropped and every
 * duration is bounded so a malformed request cannot poison the calendar.
 */
function sanitizeSession(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return null
  const id = typeof input.id === 'string' ? input.id.trim().slice(0, 128) : ''
  if (!id) return null
  if (!isFiniteNonNegative(input.startedAt)) return null
  if (!isFiniteNonNegative(input.activeMs)) return null

  const startedAt = clampNumber(input.startedAt, Date.now() + 24 * 60 * 60 * 1000)
  const activeMs = clampNumber(input.activeMs, MAX_SESSION_MS)
  // Visits under a minute are not records and never enter durable storage.
  if (activeMs < MIN_RECORD_MS) return null
  const endedAt = input.endedAt === null || input.endedAt === undefined || !isFiniteNonNegative(input.endedAt)
    ? null
    : clampNumber(input.endedAt, Date.now() + 24 * 60 * 60 * 1000)
  const lastActiveAt = isFiniteNonNegative(input.lastActiveAt)
    ? clampNumber(input.lastActiveAt, Date.now() + 24 * 60 * 60 * 1000)
    : startedAt
  const updatedAt = isFiniteNonNegative(input.updatedAt)
    ? clampNumber(input.updatedAt, Date.now() + 24 * 60 * 60 * 1000)
    : Date.now()

  const days = {}
  if (input.days && typeof input.days === 'object' && !Array.isArray(input.days)) {
    let count = 0
    for (const [key, value] of Object.entries(input.days)) {
      if (count >= MAX_DAYS_PER_SESSION) break
      if (!DAY_KEY.test(key) || !isFiniteNonNegative(value)) continue
      days[key] = clampNumber(value, MAX_DAY_MS)
      count += 1
    }
  }

  return {
    id,
    startedAt,
    endedAt,
    lastActiveAt,
    activeMs,
    days,
    finalized: input.finalized === true,
    updatedAt,
    ...(typeof input.pauseReason === 'string'
      ? { pauseReason: input.pauseReason.slice(0, 32) }
      : {})
  }
}

async function readStore() {
  let text
  let migratedFromLegacy = false
  try {
    text = await readFile(DATA_FILE, 'utf8')
  } catch (error) {
    if (!error || error.code !== 'ENOENT') throw error
    // One-time move from the old profile-local file into dstime_data.
    try {
      text = await readFile(LEGACY_DATA_FILE, 'utf8')
      migratedFromLegacy = true
    } catch (legacyError) {
      if (legacyError && legacyError.code === 'ENOENT') return emptyStore()
      throw legacyError
    }
  }
  try {
    const parsed = JSON.parse(text)
    if (parsed?.version !== DATA_VERSION) return emptyStore()
    const sessions = Array.isArray(parsed.sessions)
      ? parsed.sessions.map(sanitizeSession).filter(Boolean)
      : []
    const store = {
      version: DATA_VERSION,
      updatedAt: isFiniteNonNegative(parsed.updatedAt) ? parsed.updatedAt : Date.now(),
      sessions
    }
    if (migratedFromLegacy && sessions.length) {
      try {
        await writeStore(store)
      } catch {
        // The legacy read still succeeds; a later POST retries the write.
      }
    }
    return store
  } catch {
    // A torn or hand-edited file should not make the endpoint unusable.
    return emptyStore()
  }
}

async function writeStore(store) {
  await mkdir(dirname(DATA_FILE), { recursive: true })
  const temporary = `${DATA_FILE}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, 'utf8')
  try {
    await rename(temporary, DATA_FILE)
  } catch (error) {
    if (error && (error.code === 'EEXIST' || error.code === 'EPERM')) {
      await rm(DATA_FILE, { force: true })
      await rename(temporary, DATA_FILE)
      return
    }
    await rm(temporary, { force: true })
    throw error
  }
}

function sendJson(res, status, body) {
  const text = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('content-length', Buffer.byteLength(text))
  res.end(text)
}

function sendMethodNotAllowed(res, allow) {
  res.setHeader('allow', allow)
  sendJson(res, 405, { ok: false, error: 'method-not-allowed' })
}

async function readBody(req) {
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.length
    if (total > MAX_BODY_BYTES) {
      const error = new Error('request body too large')
      error.status = 413
      throw error
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function mergeSessions(existing, incoming) {
  const byId = new Map(existing.map((session) => [session.id, session]))
  for (const session of incoming) {
    const previous = byId.get(session.id)
    if (!previous || session.updatedAt >= previous.updatedAt) byId.set(session.id, session)
  }
  return [...byId.values()]
    .sort((left, right) => left.startedAt - right.startedAt)
    .slice(-MAX_SESSIONS)
}

export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ROUTE,
    handler: async (req, res) => {
      if (req.method === 'GET' || req.method === 'HEAD') {
        try {
          const store = await readStore()
          sendJson(res, 200, {
            ok: true,
            version: DATA_VERSION,
            storage: DATA_FILE,
            sessions: store.sessions
          })
        } catch (error) {
          console.error('[time-ledger] failed to read storage:', error)
          sendJson(res, 500, { ok: false, error: 'storage-read-failed' })
        }
        return
      }

      if (req.method !== 'POST') {
        sendMethodNotAllowed(res, 'GET, HEAD, POST')
        return
      }

      const contentType = String(req.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase()
      if (contentType !== 'application/json') {
        sendJson(res, 415, { ok: false, error: 'content-type-must-be-application-json' })
        return
      }

      let payload
      try {
        const text = await readBody(req)
        payload = JSON.parse(text)
      } catch (error) {
        sendJson(res, error?.status === 413 ? 413 : 400, {
          ok: false,
          error: error?.status === 413 ? 'body-too-large' : 'invalid-json'
        })
        return
      }

      const rawSessions = Array.isArray(payload?.sessions)
        ? payload.sessions
        : payload?.session
          ? [payload.session]
          : []
      const incoming = rawSessions.map(sanitizeSession).filter(Boolean)
      if (incoming.length === 0) {
        sendJson(res, 400, { ok: false, error: 'no-valid-session' })
        return
      }

      try {
        const result = await enqueueWrite(async () => {
          const store = await readStore()
          const sessions = mergeSessions(store.sessions, incoming)
          await writeStore({ version: DATA_VERSION, updatedAt: Date.now(), sessions })
          return sessions.length
        })
        sendJson(res, 200, { ok: true, saved: incoming.length, total: result, storage: DATA_FILE })
      } catch (error) {
        console.error('[time-ledger] failed to write storage:', error)
        sendJson(res, 500, { ok: false, error: 'storage-write-failed' })
      }
    }
  }), `time-ledger: state route ${ROUTE}`)
}
