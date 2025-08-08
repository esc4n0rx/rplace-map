/**
 * In-memory state for the r/place-like grid and SSE subscribers.
 * Notes:
 * - This is per server instance. For production, replace with a durable pub/sub plus a database.
 * - Grid is sparse: store only painted pixels in a Map.
 */

export type PaintEvent = {
  type: "paint"
  x: number
  y: number
  color: string
  userId?: string
  t?: number
}

const GRID_WIDTH = 512
const GRID_HEIGHT = 256

// Sparse pixel storage: "x,y" -> color
const pixels = new Map<string, string>()

// Simple pub/sub for SSE
type Subscriber = {
  id: string
  send: (line: string) => void
  close?: () => void
}
const subscribers = new Map<string, Subscriber>()

function broadcastJSON(obj: unknown) {
  const data = `data: ${JSON.stringify(obj)}\n\n`
  for (const sub of subscribers.values()) {
    try {
      sub.send(data)
    } catch {
      // drop broken subscriber
      subscribers.delete(sub.id)
    }
  }
}

export function subscribe(sub: Subscriber) {
  subscribers.set(sub.id, sub)
  // Optionally send a hello event
  try {
    sub.send(`event: hello\ndata: "ok"\n\n`)
  } catch {}
  return () => {
    if (sub.close) {
      try {
        sub.close()
      } catch {}
    }
    subscribers.delete(sub.id)
  }
}

export function getInitialState() {
  const list: { x: number; y: number; color: string }[] = []
  for (const [key, color] of pixels.entries()) {
    const [xs, ys] = key.split(",")
    list.push({ x: Number(xs), y: Number(ys), color })
  }
  return {
    gridWidth: GRID_WIDTH,
    gridHeight: GRID_HEIGHT,
    pixels: list,
  }
}

// Naive per-user cooldown using a token bucket stored in memory.
type Bucket = { tokens: number; lastRefill: number }
const CAPACITY = 10
const REFILL_MS = 6000 // 1 token every 6s

const buckets = new Map<string, Bucket>()

function refill(bucket: Bucket) {
  const now = Date.now()
  const elapsed = now - bucket.lastRefill
  const toAdd = Math.floor(elapsed / REFILL_MS)
  if (toAdd > 0) {
    bucket.tokens = Math.min(CAPACITY, bucket.tokens + toAdd)
    bucket.lastRefill = bucket.lastRefill + toAdd * REFILL_MS
  }
}

function getBucket(userId: string) {
  let b = buckets.get(userId)
  if (!b) {
    b = { tokens: CAPACITY, lastRefill: Date.now() }
    buckets.set(userId, b)
  } else {
    refill(b)
  }
  return b
}

export function canPaint(userId: string) {
  const b = getBucket(userId)
  return b.tokens > 0
}

export function consumeToken(userId: string) {
  const b = getBucket(userId)
  if (b.tokens > 0) {
    b.tokens -= 1
    return true
  }
  return false
}

export function tokensLeft(userId: string) {
  return getBucket(userId).tokens
}

export function paintPixel(x: number, y: number, color: string, userId?: string) {
  if (x < 0 || y < 0 || x >= GRID_WIDTH || y >= GRID_HEIGHT) {
    throw new Error("Coordenadas inválidas")
  }
  pixels.set(`${x},${y}`, color)
  const evt: PaintEvent = { type: "paint", x, y, color, userId, t: Date.now() }
  broadcastJSON(evt)
}
