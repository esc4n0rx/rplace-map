"use client"

import "maplibre-gl/dist/maplibre-gl.css"
import { useCallback, useEffect, useRef, useState } from "react"
import maplibregl, { type Map as MapLibreMap } from "maplibre-gl"
import { usePixelBank } from "./pixel-bank"
import { AnimatePresence, motion } from "framer-motion"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { Palette, Paintbrush } from "lucide-react"

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

// Coordenadas do mundo
const WORLD_BOUNDS = {
  west: -180,
  east: 180,
  north: 85.0511,
  south: -85.0511,
}

// Cores pré-definidas
const PRESET_COLORS = [
  "#ff0000", "#00ff00", "#0000ff", "#ffff00", "#ff00ff", "#00ffff",
  "#ffffff", "#000000", "#808080", "#800000", "#008000", "#000080",
  "#808000", "#800080", "#008080", "#c0c0c0", "#ff8000", "#8000ff"
]

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
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null)
  const pixelSourceAddedRef = useRef(false)

  const [gridSize, setGridSize] = useState<{ w: number; h: number }>({ w: 1024, h: 512 }) // Grid maior para mais precisão
  const [pixels, setPixels] = useState<Map<string, string>>(() => new Map())

  // Estados da UI
  const [selectedColor, setSelectedColor] = useState("#ff0055")
  const [isPaintMode, setIsPaintMode] = useState(false)
  const [showColorPicker, setShowColorPicker] = useState(false)
  const [ripple, setRipple] = useState<{ x: number; y: number; key: number } | null>(null)

  const { canSpend, spendToken, setTokensFromServer } = usePixelBank()

  // Cria o canvas para os pixels
  const ensureCanvas = useCallback(() => {
    if (!canvasRef.current) {
      const canvas = document.createElement("canvas")
      canvas.width = gridSize.w
      canvas.height = gridSize.h
      canvas.style.display = "none"
      canvas.id = "pixel-canvas"
      document.body.appendChild(canvas)
      canvasRef.current = canvas
      
      const ctx = canvas.getContext("2d")
      if (ctx) {
        ctx.imageSmoothingEnabled = false
        // Fundo transparente
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        ctxRef.current = ctx
      }
    }
  }, [gridSize.w, gridSize.h])

  // Desenha um pixel no canvas - CORRIGIDO
  const drawPixel = useCallback((x: number, y: number, col: string) => {
    const ctx = ctxRef.current
    if (!ctx) return
    
    // Desenha o pixel
    ctx.fillStyle = col
    ctx.fillRect(x, y, 1, 1)
    
    console.log(`Desenhando pixel em (${x}, ${y}) com cor ${col}`)
    
    // Força atualização do source no mapa
    const map = mapRef.current
    if (map && map.getSource("pixels")) {
      const source = map.getSource("pixels") as maplibregl.CanvasSource
      // Pausa e reinicia para forçar update
      source.pause()
      setTimeout(() => source.play(), 10)
    }
  }, [])

  // Redesenha todos os pixels
  const redrawAllPixels = useCallback(() => {
    const ctx = ctxRef.current
    const canvas = canvasRef.current
    if (!ctx || !canvas) return

    // Limpa o canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    
    console.log(`Redesenhando ${pixels.size} pixels`)
    
    // Desenha todos os pixels
    for (const [key, col] of pixels.entries()) {
      const [xs, ys] = key.split(",")
      const x = Number(xs)
      const y = Number(ys)
      ctx.fillStyle = col
      ctx.fillRect(x, y, 1, 1)
    }

    // Força atualização
    const map = mapRef.current
    if (map && map.getSource("pixels")) {
      const source = map.getSource("pixels") as maplibregl.CanvasSource
      source.pause()
      setTimeout(() => source.play(), 10)
    }
  }, [pixels])

  // Converte coordenadas lng/lat para posição da grade - CORRIGIDO
  const lngLatToGrid = useCallback((lng: number, lat: number) => {
    // Garante que as coordenadas estão dentro dos limites
    const clampedLng = Math.max(WORLD_BOUNDS.west, Math.min(WORLD_BOUNDS.east, lng))
    const clampedLat = Math.max(WORLD_BOUNDS.south, Math.min(WORLD_BOUNDS.north, lat))
    
    // Normaliza para 0-1
    const normalizedX = (clampedLng - WORLD_BOUNDS.west) / (WORLD_BOUNDS.east - WORLD_BOUNDS.west)
    const normalizedY = (WORLD_BOUNDS.north - clampedLat) / (WORLD_BOUNDS.north - WORLD_BOUNDS.south)
    
    // Mapeia para a grade
    const x = Math.floor(normalizedX * gridSize.w)
    const y = Math.floor(normalizedY * gridSize.h)
    
    console.log(`Conversão: lng=${lng.toFixed(6)}, lat=${lat.toFixed(6)} -> x=${x}, y=${y}`)
    
    if (x < 0 || x >= gridSize.w || y < 0 || y >= gridSize.h) return null
    return { x, y }
  }, [gridSize])

  // Salva pixel no localStorage
  const savePixelToStorage = useCallback((x: number, y: number, color: string) => {
    try {
      const stored = localStorage.getItem("painted-pixels") || "{}"
      const pixelData = JSON.parse(stored)
      const key = `${x},${y}`
      pixelData[key] = {
        color,
        userId: getUserId(),
        timestamp: Date.now()
      }
      localStorage.setItem("painted-pixels", JSON.stringify(pixelData))
      console.log(`Pixel salvo: (${x}, ${y}) = ${color}`)
    } catch (e) {
      console.error("Erro ao salvar pixel:", e)
    }
  }, [])

  // Carrega pixels do localStorage
  const loadPixelsFromStorage = useCallback(() => {
    try {
      const stored = localStorage.getItem("painted-pixels")
      if (stored) {
        const pixelData = JSON.parse(stored)
        const pixelMap = new Map<string, string>()
        
        Object.entries(pixelData).forEach(([key, data]: [string, any]) => {
          pixelMap.set(key, data.color)
        })
        
        console.log(`Carregados ${pixelMap.size} pixels do storage`)
        setPixels(pixelMap)
      }
    } catch (e) {
      console.error("Erro ao carregar pixels:", e)
    }
  }, [])

  // Função de pintura - CORRIGIDA
  const paintPixel = useCallback((lng: number, lat: number, clientX: number, clientY: number) => {
    if (!isPaintMode || !canSpend) return
    
    const gridPos = lngLatToGrid(lng, lat)
    if (!gridPos) return
    
    // Consome token
    if (!spendToken()) return
    
    console.log(`Pintando pixel em (${gridPos.x}, ${gridPos.y}) com cor ${selectedColor}`)
    
    // Atualização do estado
    setPixels((prev) => {
      const next = new Map(prev)
      next.set(`${gridPos.x},${gridPos.y}`, selectedColor)
      return next
    })
    
    // Desenha imediatamente
    drawPixel(gridPos.x, gridPos.y, selectedColor)
    
    // Salva no storage
    savePixelToStorage(gridPos.x, gridPos.y, selectedColor)
    
    // Efeito visual
    setRipple({
      x: clientX,
      y: clientY,
      key: Date.now()
    })
  }, [isPaintMode, canSpend, spendToken, lngLatToGrid, selectedColor, drawPixel, savePixelToStorage])

  // Inicializa o MapLibre - CORRIGIDO
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return

    const container = containerRef.current
    
    const map = new maplibregl.Map({
      container: container,
      style: {
        version: 8,
        sources: {
          "osm": {
            type: "raster",
            tiles: [
              "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
              "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
              "https://c.tile.openstreetmap.org/{z}/{x}/{y}.png",
            ],
            tileSize: 256,
            attribution: '© OpenStreetMap contributors',
          },
        },
        layers: [
          {
            id: "osm",
            type: "raster",
            source: "osm",
          },
        ],
      },
      center: [0, 0],
      zoom: 2,
      minZoom: 0,
      maxZoom: 22,
      pitchWithRotate: false,
      dragRotate: false,
    })

    mapRef.current = map

    map.on("load", () => {
      ensureCanvas()
      
      if (canvasRef.current && !pixelSourceAddedRef.current) {
        // Adiciona source de pixels
        map.addSource("pixels", {
          type: "canvas",
          canvas: canvasRef.current,
          coordinates: [
            [WORLD_BOUNDS.west, WORLD_BOUNDS.north],
            [WORLD_BOUNDS.east, WORLD_BOUNDS.north],
            [WORLD_BOUNDS.east, WORLD_BOUNDS.south],
            [WORLD_BOUNDS.west, WORLD_BOUNDS.south],
          ],
          animate: true,
        })

        // Adiciona layer de pixels
        map.addLayer({
          id: "pixels-layer",
          type: "raster",
          source: "pixels",
          paint: {
            "raster-opacity": 0.8,
          },
        })

        pixelSourceAddedRef.current = true
        
        // Carrega pixels salvos
        loadPixelsFromStorage()
      }

      // Event listener para pintura - CORRIGIDO
      map.on("click", (e) => {
        e.preventDefault()
        
        const { lng, lat } = e.lngLat
        const rect = container.getBoundingClientRect()
        const clientX = rect.left + e.point.x
        const clientY = rect.top + e.point.y
        
        paintPixel(lng, lat, clientX, clientY)
      })

      // Cursor dinâmico
      map.on("mousemove", () => {
        const canvas = map.getCanvas()
        canvas.style.cursor = isPaintMode && canSpend ? "crosshair" : "grab"
      })

      map.on("dragstart", () => {
        map.getCanvas().style.cursor = "grabbing"
      })
    })

    return () => {
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
      }
      if (canvasRef.current && document.body.contains(canvasRef.current)) {
        document.body.removeChild(canvasRef.current)
        canvasRef.current = null
      }
      pixelSourceAddedRef.current = false
    }
  }, [ensureCanvas, loadPixelsFromStorage, isPaintMode, canSpend, paintPixel])

  // Carrega estado inicial do servidor
  useEffect(() => {
    let cancelled = false
    
    const loadInitialState = async () => {
      try {
        const res = await fetch("/api/state", { cache: "no-store" })
        if (!res.ok) {
          loadPixelsFromStorage()
          return
        }
        
        const data: InitialState = await res.json()
        if (cancelled) return

        setGridSize({ w: data.gridWidth, h: data.gridHeight })
        
        const pixelMap = new Map<string, string>()
        for (const p of data.pixels) {
          pixelMap.set(`${p.x},${p.y}`, p.color)
        }
        setPixels(pixelMap)
      } catch (e) {
        loadPixelsFromStorage()
      }
    }

    loadInitialState()
    
    return () => {
      cancelled = true
    }
  }, [loadPixelsFromStorage])

  // Atualiza canvas quando pixels mudam
  useEffect(() => {
    if (pixels.size > 0) {
      redrawAllPixels()
    }
  }, [pixels, redrawAllPixels])

  // Toggle modo de pintura - CORRIGIDO (não reseta zoom)
  const togglePaintMode = useCallback(() => {
    setIsPaintMode(prev => {
      const newMode = !prev
      setShowColorPicker(false)
      
      // Atualiza cursor imediatamente
      if (mapRef.current) {
        const canvas = mapRef.current.getCanvas()
        canvas.style.cursor = newMode && canSpend ? "crosshair" : "grab"
      }
      
      return newMode
    })
  }, [canSpend])

  // Seleção de cor
  const selectColor = useCallback((color: string) => {
    setSelectedColor(color)
    setShowColorPicker(false)
  }, [])

  return (
    <div className="relative">
      <div
        ref={containerRef}
        className="h-[calc(100dvh-4rem)] min-h-[360px] w-full"
        aria-label="Mapa mundial interativo de pixels"
      />

      {/* Controles flutuantes */}
      <div className="absolute top-4 right-4 z-50 flex flex-col gap-2">
        {/* Botão de modo pintura */}
        <Button
          onClick={togglePaintMode}
          variant={isPaintMode ? "default" : "outline"}
          size="sm"
          className={cn(
            "flex items-center gap-2 shadow-lg backdrop-blur-sm",
            isPaintMode ? "bg-blue-600 hover:bg-blue-700 text-white" : "bg-white/90 hover:bg-white"
          )}
        >
          <Paintbrush className="h-4 w-4" />
          {isPaintMode ? "Pintura ATIVA" : "Ativar Pintura"}
        </Button>

        {/* Seletor de cor */}
        {isPaintMode && (
          <div className="bg-white/95 backdrop-blur-sm rounded-lg shadow-lg p-3 border">
            <Button
              onClick={() => setShowColorPicker(!showColorPicker)}
              variant="outline"
              size="sm"
              className="flex items-center gap-2 w-full mb-2"
            >
              <div
                className="w-4 h-4 rounded border border-gray-400"
                style={{ backgroundColor: selectedColor }}
              />
              <Palette className="h-4 w-4" />
              Cor Selecionada
            </Button>

            {showColorPicker && (
              <div className="grid grid-cols-6 gap-1">
                {PRESET_COLORS.map((color) => (
                  <button
                    key={color}
                    onClick={() => selectColor(color)}
                    className={cn(
                      "w-7 h-7 rounded border-2 hover:scale-110 transition-transform",
                      selectedColor === color ? "border-blue-600 border-2" : "border-gray-300"
                    )}
                    style={{ backgroundColor: color }}
                    title={color}
                  />
                ))}
                <input
                  type="color"
                  value={selectedColor}
                  onChange={(e) => selectColor(e.target.value)}
                  className="w-7 h-7 rounded border-2 border-gray-300 cursor-pointer"
                  title="Cor personalizada"
                />
              </div>
            )}
          </div>
        )}

        {/* Status */}
        {isPaintMode && (
          <div className="bg-white/95 backdrop-blur-sm rounded-lg shadow-lg p-3 border text-sm">
            <div className={cn("font-medium", canSpend ? "text-green-600" : "text-orange-600")}>
              {canSpend ? "✓ Clique para pintar!" : "⏳ Aguardando tokens..."}
            </div>
            <div className="text-xs text-gray-500 mt-1">
              Pixels pintados: {pixels.size}
            </div>
          </div>
        )}
      </div>

      {/* Debug info (removível em produção) */}
      <div className="absolute bottom-4 left-4 z-50 bg-black/70 text-white text-xs p-2 rounded font-mono">
        <div>Grid: {gridSize.w}x{gridSize.h}</div>
        <div>Pixels: {pixels.size}</div>
        <div>Modo: {isPaintMode ? "PINTURA" : "NAVEGAÇÃO"}</div>
      </div>

      {/* Efeito de ripple */}
      <AnimatePresence>
        {ripple && (
          <motion.span
            key={ripple.key}
            className="pointer-events-none fixed z-50 rounded-full border-2 border-white"
            style={{
              backgroundColor: selectedColor,
              width: 20,
              height: 20,
              left: ripple.x - 10,
              top: ripple.y - 10,
            }}
            initial={{ scale: 0, opacity: 0.8 }}
            animate={{ scale: 3, opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            onAnimationComplete={() => setRipple(null)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}