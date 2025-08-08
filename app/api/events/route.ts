/**
 * Server-Sent Events endpoint for real-time updates.
 * Keeps a list of subscribers in memory and broadcasts paint events to them.
 */
export const dynamic = "force-dynamic"

import { subscribe } from "../_place-store"

export async function GET() {
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder()
      const id = crypto.randomUUID()
      const send = (line: string) => controller.enqueue(encoder.encode(line))
      const close = () => {
        try {
          controller.close()
        } catch {}
      }
      const unsubscribe = subscribe({ id, send, close })

      // Heartbeat to keep connections alive
      const hb = setInterval(() => {
        try {
          send(": hb\n\n")
        } catch {}
      }, 15000)

      // On client disconnect
      const cancel = () => {
        clearInterval(hb)
        unsubscribe()
        try {
          controller.close()
        } catch {}
      }

      // Abort on connection close if supported
      // Note: Next.js Route Handlers don't pass Request here, so we rely on client/network to close.
      // The stream close path handles cleanup.
      // We still set a max duration fallback:
      const max = setTimeout(cancel, 1000 * 60 * 60) // 1 hour
      // Attach to controller's closed promise if available
      // @ts-expect-error - not in lib types
      controller?.closed?.then?.(() => {
        clearTimeout(max)
        cancel()
      })
    },
    cancel() {
      // Reader canceled
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  })
}
