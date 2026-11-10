import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * Il 404 della radice, in italiano: per un indirizzo che non esiste e per chi apre un workspace di cui non fa
 * parte (il layout del workspace chiama `notFound()` e sopra di lui non c'è un'altra pagina «non trovata»).
 * Prima si vedeva quello inglese di Next («This page could not be found»). Non dice se la pagina esiste per
 * qualcun altro: lo stesso testo per tutti.
 */
export const metadata: Metadata = {
  title: "Pagina non trovata",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-16 text-foreground">
      <div className="max-w-md space-y-3 text-center">
        <p className="text-sm font-medium tabular-nums text-muted-foreground">404</p>
        <h1 className="text-2xl font-semibold tracking-tight">Pagina non trovata</h1>
        <p className="text-sm text-muted-foreground">L&apos;indirizzo non esiste, oppure questa pagina non è per il tuo account.</p>
        <div className="flex flex-wrap justify-center gap-2 pt-2">
          <Button className="h-11 sm:h-9" render={<Link href="/dashboard" />} nativeButton={false}>
            Vai alla dashboard
          </Button>
          <Button variant="outline" className="h-11 sm:h-9" render={<Link href="/" />} nativeButton={false}>
            Torna all&apos;inizio
          </Button>
        </div>
      </div>
    </main>
  );
}
