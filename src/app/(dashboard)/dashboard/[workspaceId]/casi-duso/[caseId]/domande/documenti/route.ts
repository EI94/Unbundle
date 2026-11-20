import type { NextRequest } from "next/server";
import { notFound, permanentRedirect } from "next/navigation";
import { legacyCaseRouteFromPath } from "@/lib/uc/views/legacy-routes";

/**
 * (Rilascio 10, §3.5) La pagina Documenti di ieri: l'archivio è il pannello «File» di Domande (`?apri=file`) e i
 * documenti richiesti sono il filtro «Documenti». 308 verso Domande con il pannello aperto, senza leggere il database
 * (`legacyCaseRoute`): i link già partiti (la Panoramica, Persone, le e-mail) aprono lo stesso contenuto.
 *
 * È una route e non una pagina: sotto `domande/loading.tsx` la risposta di una pagina parte in streaming e un
 * redirect diventerebbe un 200 con meta refresh (`loading.md`, «Status Codes»); la route risponde subito 308.
 */
export function GET(request: NextRequest) {
  const target = legacyCaseRouteFromPath(request.nextUrl.pathname, request.nextUrl.searchParams);
  if (!target) notFound();
  permanentRedirect(target);
}
