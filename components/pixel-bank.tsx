"use client"

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"

type PixelBankContextType = {
  tokens: number
  capacity: number
  canSpend: boolean
  spendToken: () => boolean
  resetCapacity: () => void
  setTokensFromServer: (v: number) => void
}

// Simple token bucket: capacity N, refill one token every refillMs.
const DEFAULT_CAPACITY = 10
const REFILL_MS = 6000 // 1 token every 6s => 10 tokens per minute

const PixelBankContext = createContext<PixelBankContextType | null>(null)

export function PixelBankProvider({ children }: { children: React.ReactNode }) {
  const [tokens, setTokens] = useState<number>(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem("pixel-tokens") : null
    return saved ? Number(saved) : DEFAULT_CAPACITY
  })
  const lastRefillRef = useRef<number>(Date.now())

  useEffect(() => {
    localStorage.setItem("pixel-tokens", String(tokens))
  }, [tokens])

  // Refill loop
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now()
      const elapsed = now - lastRefillRef.current
      if (elapsed >= REFILL_MS) {
        lastRefillRef.current = now
        setTokens((t) => Math.min(DEFAULT_CAPACITY, t + 1))
      }
    }, 500)
    return () => clearInterval(id)
  }, [])

  const spendToken = useCallback(() => {
    let spent = false
    setTokens((t) => {
      if (t > 0) {
        spent = true
        return t - 1
      }
      return t
    })
    return spent
  }, [])

  const resetCapacity = useCallback(() => {
    setTokens(DEFAULT_CAPACITY)
    lastRefillRef.current = Date.now()
  }, [])

  const setTokensFromServer = useCallback((v: number) => {
    setTokens(Math.max(0, Math.min(DEFAULT_CAPACITY, v)))
  }, [])

  const value = useMemo(
    () => ({
      tokens,
      capacity: DEFAULT_CAPACITY,
      canSpend: tokens > 0,
      spendToken,
      resetCapacity,
      setTokensFromServer,
    }),
    [tokens, spendToken, resetCapacity, setTokensFromServer],
  )

  return <PixelBankContext.Provider value={value}>{children}</PixelBankContext.Provider>
}

export function usePixelBank() {
  const ctx = useContext(PixelBankContext)
  if (!ctx) {
    throw new Error("usePixelBank must be used within PixelBankProvider")
  }
  return ctx
}
