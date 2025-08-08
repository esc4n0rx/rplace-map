"use client"

import { useEffect, useMemo, useState } from "react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { LogOut } from 'lucide-react'
import { usePixelBank } from "./pixel-bank"
import { motion } from "framer-motion"

type UserProfile = {
  id: string
  name: string
  avatarUrl: string
}

function randomName() {
  const adj = ["Solar", "Ágil", "Sereno", "Vivo", "Áureo", "Vasto", "Brando", "Ártico", "Pulsante", "Nítido"]
  const noun = ["Pixel", "Atlas", "Mosaico", "Vértice", "Aurora", "Nimbus", "Orbe", "Galáxia", "Vetor", "Eco"]
  return `${adj[Math.floor(Math.random() * adj.length)]} ${noun[Math.floor(Math.random() * noun.length)]}`
}

function createUser(): UserProfile {
  const name = randomName()
  const initials = name
    .split(" ")
    .map((s) => s[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()
  return {
    id: crypto.randomUUID(),
    name,
    avatarUrl: "/placeholder.svg?height=64&width=64",
  }
}

export default function Header() {
  const [user, setUser] = useState<UserProfile | null>(null)
  const { tokens, capacity, resetCapacity } = usePixelBank()

  useEffect(() => {
    const saved = localStorage.getItem("user-profile")
    if (saved) {
      setUser(JSON.parse(saved))
    } else {
      const u = createUser()
      localStorage.setItem("user-profile", JSON.stringify(u))
      setUser(u)
    }
  }, [])

  const initials = useMemo(() => {
    if (!user) return "U"
    return user.name
      .split(" ")
      .map((s) => s[0])
      .join("")
      .slice(0, 2)
      .toUpperCase()
  }, [user])

  function signOut() {
    // Reset local user, tokens, and create a new identity
    const u = createUser()
    localStorage.setItem("user-profile", JSON.stringify(u))
    setUser(u)
    resetCapacity()
  }

  return (
    <header className="fixed inset-x-0 top-0 z-50">
      <div className="mx-auto max-w-[1400px] px-3 sm:px-4">
        <div className="mt-2 rounded-xl border border-white/40 bg-white/60 backdrop-blur supports-[backdrop-filter]:bg-white/50 shadow-sm">
          <div className="flex items-center gap-3 px-3 py-2 sm:px-4">
            <div className="flex items-center gap-3 min-w-0">
              <Avatar className="h-8 w-8 sm:h-9 sm:w-9">
                <AvatarImage src={user?.avatarUrl ?? ""} alt={user ? `Avatar de ${user.name}` : "Avatar"} />
                <AvatarFallback>{initials}</AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <div className="text-sm font-semibold truncate">{user?.name ?? "Visitante"}</div>
                <div className="text-xs text-neutral-600 truncate">r.place • mapa mundial</div>
              </div>
            </div>

            <div className="ml-auto flex items-center gap-2 sm:gap-3">
              <motion.div
                className="rounded-full border bg-white px-3 py-1 text-xs sm:text-sm font-medium text-neutral-800"
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", stiffness: 400, damping: 24 }}
                aria-live="polite"
              >
                Pixels: {tokens}/{capacity}
              </motion.div>
              <Button variant="ghost" size="sm" className="gap-1" onClick={signOut}>
                <LogOut className="h-4 w-4" />
                <span className="hidden sm:inline">Sair</span>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </header>
  )
}
