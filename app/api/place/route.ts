import { NextResponse } from "next/server"
import { canPaint, consumeToken, paintPixel, tokensLeft } from "../_place-store"

type Body = { x: number; y: number; color: string; userId?: string }

function isHexColor(s: string) {
  return /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.test(s)
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body
    const { x, y, color, userId } = body || {}
    if (typeof x !== "number" || typeof y !== "number" || typeof color !== "string") {
      return NextResponse.json({ error: "Parâmetros inválidos" }, { status: 400 })
    }
    if (!isHexColor(color)) {
      return NextResponse.json({ error: "Cor inválida" }, { status: 400 })
    }
    const uid = userId || "anon"
    if (!canPaint(uid)) {
      return NextResponse.json({ error: "Cooldown ativo" }, { status: 429, headers: { "Retry-After": "5" } })
    }
    const ok = consumeToken(uid)
    if (!ok) {
      return NextResponse.json({ error: "Sem tokens" }, { status: 429 })
    }

    paintPixel(x, y, color, uid)
    return NextResponse.json({ ok: true, tokensLeft: tokensLeft(uid) })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Erro inesperado" }, { status: 500 })
  }
}
