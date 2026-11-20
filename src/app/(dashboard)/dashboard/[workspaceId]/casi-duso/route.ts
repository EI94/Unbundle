import type { NextRequest } from "next/server";
import { notFound, permanentRedirect } from "next/navigation";
import { legacyRouteRedirect, stubLogEntry } from "@/lib/use-cases/legacy-routes";

/**
 * (Rilascio 10, D9 (a), F-016, F-018) La lista `/casi-duso` non c'è più (si chiude P0-16): le realizzazioni stanno in
 * Use case › Panoramica › «In realizzazione», e ognuna si apre dalla scheda del suo use case. L'indirizzo risponde 308
 * verso la Panoramica (`/use-cases?vista=panoramica`, `legacyRouteRedirect`), con una riga di log senza id né query
 * (`stubLogEntry`, come gli altri indirizzi vecchi dell'area): la sua query si lascia cadere, la lista non ne aveva.
 * Nessuna lettura del database: la Panoramica controlla chi guarda.
 *
 * È una route e non una pagina: sotto `casi-duso/loading.tsx` la risposta di una pagina parte in streaming e un
 * redirect diventerebbe un 200 con meta refresh (`loading.md`, «Status Codes»); la route risponde subito 308. Le
 * pagine sotto `casi-duso/` (la realizzazione, `nuovo`) restano.
 */
export function GET(request: NextRequest) {
  const legacy = legacyRouteRedirect(request.nextUrl.pathname, undefined, { dossierLinksReady: true });
  if (!legacy || legacy.from !== "/casi-duso") notFound();
  console.info(JSON.stringify(stubLogEntry(legacy.from)));
  permanentRedirect(legacy.to);
}
