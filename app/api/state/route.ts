import { NextResponse } from "next/server"
import { getInitialState } from "../_place-store"

export async function GET() {
  const state = getInitialState()
  return NextResponse.json(state, {
    headers: {
      "Cache-Control": "no-store",
    },
  })
}
