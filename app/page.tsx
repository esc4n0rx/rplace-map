import { Suspense } from "react"
import Header from "@/components/header"
import MapPlace from "@/components/map-place"
import { PixelBankProvider } from "@/components/pixel-bank"

export default async function Page() {
  // Server Component by default; wraps client parts.
  return (
    <div className="min-h-dvh bg-white text-neutral-900">
      <PixelBankProvider>
        <Header />
        <main className="relative pt-16"> 
          <Suspense>
            <MapPlace />
          </Suspense>
        </main>
      </PixelBankProvider>
    </div>
  )
}
