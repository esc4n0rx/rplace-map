"use client"

import "maplibre-gl/dist/maplibre-gl.css"
import { useCallback, useEffect, useRef, useState } from "react"
import maplibregl, { type Map as MapLibreMap } from "maplibre-gl"
import { usePixelBank } from "./pixel-bank"
import { AnimatePresence, motion } from "framer-motion"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type PixelEvent = {
  type: "paint"
  x: number
  y: number
  color: string
  userId?: string
  t?: number
}

type InitialState = {
  gridWidth: number
  gridHeight: number
  pixels: { x: number; y: number; color: string }[]
}

const WORLD_LAT = 85.05112878 // limite superior do Web Mercator

function getUserId() {
  try {
    const saved = localStorage.getItem("user-profile")
    if (saved) {
      const u = JSON.parse(saved)
      return u.id as string
    }
  } catch {}
  return "anon"
}

export default function MapPlace() {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MapLibreMap | null>(null)

  // Canvas usado como source "canvas" do MapLibre
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null)
  const canvasSourceAddedRef = useRef(false)

  const [gridSize, setGridSize] = useState<{ w: number; h: number }>({ w: 512, h: 256 })
  const [pixels, setPixels] = useState<Map<string, string>>(() => new Map())

  // UI: color picker
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerCoord, setPickerCoord] = useState<{
    x: number
    y: number
    clientX: number
    clientY: number
  } | null>(null)
  const [color, setColor] = useState("#ff0055")
  const [ripple, setRipple] = useState<{ x: number; y: number; key: number } | null>(null)

  const { canSpend, spendToken, setTokensFromServer } = usePixelBank()

  // Helpers para desenhar
  const ensureCanvas = useCallback(() => {
    if (!canvasRef.current) {
      const c = document.createElement("canvas")
      c.width = gridSize.w
      c.height = gridSize.h
      canvasRef.current = c
      ctxRef.current = c.getContext("2d")
      if (ctxRef.current) {
        ctxRef.current.imageSmoothingEnabled = false
      }
    } else {
      // Se a grade mudou, redimensione o canvas
      if (canvasRef.current.width !== gridSize.w || canvasRef.current.height !== gridSize.h) {
        canvasRef.current.width = gridSize.w
        canvasRef.current.height = gridSize.h
        if (ctxRef.current) {
          ctxRef.current.imageSmoothingEnabled = false
        }
      }
    }
  }, [gridSize.w, gridSize.h])

  const drawCell = useCallback(
    (x: number, y: number, col: string) => {
      ensureCanvas()
      const ctx = ctxRef.current
      if (!ctx) return
      ctx.fillStyle = col
      ctx.fillRect(x, y, 1, 1)
      // Solicita um repaint do mapa para refletir a atualização do canvas
      mapRef.current?.triggerRepaint()
    },
    [ensureCanvas],
  )

  const redrawAll = useCallback(() => {
    ensureCanvas()
    const ctx = ctxRef.current
    const c = canvasRef.current
    if (!ctx || !c) return
    ctx.clearRect(0, 0, c.width, c.height)
    for (const [key, col] of pixels.entries()) {
      const [xs, ys] = key.split(",")
      const x = Number(xs)
      const y = Number(ys)
      ctx.fillStyle = col
      ctx.fillRect(x, y, 1, 1)
    }
    mapRef.current?.triggerRepaint()
  }, [pixels, ensureCanvas])

  // Conversões: lng/lat -> célula da grade
  function lngLatToCell(lng: number, lat: number) {
    const x = Math.floor(((lng + 180) / 360) * gridSize.w)
    const y = Math.floor(((WORLD_LAT - lat) / (2 * WORLD_LAT)) * gridSize.h)
    if (x < 0 || x >= gridSize.w || y < 0 || y >= gridSize.h) return null
    return { x, y }
  }

  // Posição do popover: coordenadas do clique convertidas para clientX/clientY
  function eventClientXY(e: maplibregl.MapMouseEvent & maplibregl.EventData) {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return { clientX: e.point.x, clientY: e.point.y }
    return { clientX: rect.left + e.point.x, clientY: rect.top + e.point.y }
  }

  // Inicializa o MapLibre
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return

    const el = containerRef.current
    let destroyed = false
    let raf = 0

    const init = () => {
      if (destroyed) return
      if (el.clientWidth === 0 || el.clientHeight === 0) {
        raf = requestAnimationFrame(init)
        return
      }

      const map = new maplibregl.Map({
        container: el,
        center: [0, 0],
        zoom: 2,
        minZoom: 1,
        maxZoom: 6,
        style: {
          version: 8,
          sources: {
            osm: {
              type: "raster",
              tiles: [
                "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
                "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
                "https://c.tile.openstreetmap.org/{z}/{x}/{y}.png",
              ],
              tileSize: 256,
              attribution: 'Dados do mapa © OpenStreetMap contribuidores',
            },
          },
          layers: [
            {
              id: "osm",
              type: "raster",
              source: "osm",
            },
          ],
        } as any,
        hash: false,
        antialias: true,
        preserveDrawingBuffer: false,
      })
      mapRef.current = map

      // Redimensiona corretamente quando o container mudar
      const ro = new ResizeObserver(() => {
        map.resize()
      })
      ro.observe(el)

      map.on("load", () => {
        // Adiciona a source de canvas cobrindo o mundo
        ensureCanvas()
        const c = canvasRef.current!
        if (!canvasSourceAddedRef.current) {
          map.addSource("pixels", {
            type: "canvas",
            canvas: c,
            coordinates: [
              [-180, WORLD_LAT],
              [180, WORLD_LAT],
              [180, -WORLD_LAT],
              [-180, -WORLD_LAT],
            ],
            animate: false,
          } as any)

          map.addLayer({
            id: "pixels",
            type: "raster",
            source: "pixels",
            paint: {
              // Mantém look pixelado
              "raster-resampling": "nearest",
              "raster-opacity": 1,
            } as any,
          })

          canvasSourceAddedRef.current = true
        }

        redrawAll()

        // Clique para abrir color picker
        map.on("click", (e) => {
          const { lng, lat } = e.lngLat
          const cell = lngLatToCell(lng, lat)
          if (!cell) return
          const { clientX, clientY } = eventClientXY(e)
          setPickerCoord({ ...cell, clientX, clientY })
          setPickerOpen(true)
        })
      })

      // Limpeza
      return () => {
        ro.disconnect()
        map.remove()
      }
    }

    raf = requestAnimationFrame(init)

    return () => {
      if (raf) cancelAnimationFrame(raf)
      destroyed = true
      if (mapRef.current) {
        try {
          mapRef.current.remove()
        } catch {}
        mapRef.current = null
      }
    }
  }, [ensureCanvas, redrawAll])

  // Carrega estado inicial
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch("/api/state", { cache: "no-store" })
        if (!res.ok) throw new Error("Falha ao carregar estado inicial")
        const data: InitialState = await res.json()
        if (cancelled) return

        setGridSize({ w: data.gridWidth, h: data.gridHeight })
        // Ajusta canvas e desenha
        ensureCanvas()
        const m = new Map<string, string>()
        for (const p of data.pixels) {
          m.set(`${p.x},${p.y}`, p.color)
        }
        setPixels(m)
        setTimeout(() => redrawAll(), 0)
      } catch (e) {
        console.error(e)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [ensureCanvas, redrawAll])

  // SSE realtime
  useEffect(() => {
    const es = new EventSource("/api/events")
    es.onmessage = (ev) => {
      try {
        const evt: PixelEvent = JSON.parse(ev.data)
        if (evt.type === "paint") {
          setPixels((prev) => {
            const next = new Map(prev)
            next.set(`${evt.x},${evt.y}`, evt.color)
            return next
          })
          drawCell(evt.x, evt.y, evt.color)
        }
      } catch {}
    }
    return () => es.close()
  }, [drawCell])

  // Envia pintura ao servidor
  const submitPaint = useCallback(
    async (x: number, y: number, colorStr: string) => {
      const body = { x, y, color: colorStr, userId: getUserId() }
      const res = await fetch("/api/place", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        const data = await res.json()
        if (typeof data.tokensLeft === "number") {
          setTokensFromServer(data.tokensLeft)
        }
      }
    },
    [setTokensFromServer],
  )

  const onConfirmColor = useCallback(async () => {
    const coord = pickerCoord
    setPickerOpen(false)
    if (!coord) return
    if (!canSpend) return
    if (!spendToken()) return

    // Otimista local
    setPixels((prev) => {
      const next = new Map(prev)
      next.set(`${coord.x},${coord.y}`, color)
      return next
    })
    drawCell(coord.x, coord.y, color)
    setRipple({ x: coord.clientX, y: coord.clientY, key: Date.now() })
    await submitPaint(coord.x, coord.y, color)
  }, [pickerCoord, canSpend, spendToken, color, drawCell, submitPaint])

  return (
    <div className="relative">
      <div
        ref={containerRef}
        className="h-[calc(100dvh-4rem)] min-h-[360px] w-full rounded-none"
        aria-label="Mapa mundial interativo"
      />

      <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
        <PopoverTrigger asChild>
          <button aria-label="Abrir seletor de cor" className="sr-only" />
        </PopoverTrigger>
        <PopoverContent
          align="center"
          side="top"
          className={cn("w-56")}
          style={
            pickerCoord
              ? {
                  position: "fixed",
                  left: pickerCoord.clientX,
                  top: pickerCoord.clientY - 8,
                  transform: "translate(-50%, -100%)",
                }
              : undefined
          }
        >
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <input
                aria-label="Selecionar cor"
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="h-10 w-10 rounded-md border p-0 cursor-pointer bg-transparent"
              />
              <input
                aria-label="Código de cor"
                type="text"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="flex-1 rounded-md border px-2 py-1 text-sm"
              />
            </div>
            <Button onClick={onConfirmColor} disabled={!canSpend} className="w-full">
              {canSpend ? "Pintar pixel" : "Aguardando recarga..."}
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      <AnimatePresence>
        {ripple && (
          <motion.span
            key={ripple.key}
            className="pointer-events-none fixed z-50 rounded-full bg-pink-500/30"
            initial={{ opacity: 0.6, scale: 0 }}
            animate={{ opacity: 0, scale: 4 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
            style={{
              width: 24,
              height: 24,
              left: ripple.x - 12,
              top: ripple.y - 12,
            }}
            onAnimationComplete={() => setRipple(null)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
