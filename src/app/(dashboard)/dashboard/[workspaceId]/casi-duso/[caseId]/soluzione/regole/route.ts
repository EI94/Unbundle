import type { NextRequest } from "next/server";
import { notFound, permanentRedirect } from "next/navigation";
import { legacyCaseRouteFromPath } from "@/lib/uc/views/legacy-routes";

/**
 * (Rilascio 10, §3.5, §8.2, F-090) Le regole sono il pannello «Regole» della Soluzione: `/soluzione/regole` risponde
 * 308 verso `/soluzione?apri=regole`, con ricerca, filtri, vincoli e pagina; l'`?apri=<id>` di ieri è la regola aperta
 * (`regola=<id>`). Nessuna lettura del database: l'accesso lo controlla la Soluzione (le regole le vede chi apre il
 * catalogo). Lo usano le condizioni del via e i link già partiti.
 *
 * È una route e non una pagina: sotto `soluzione/loading.tsx` la risposta di una pagina parte in streaming e un
 * redirect diventerebbe un 200 con meta refresh (`loading.md`, «Status Codes»); la route risponde subito 308.
 */
export function GET(request: NextRequest) {
  const target = legacyCaseRouteFromPath(request.nextUrl.pathname, request.nextUrl.searchParams);
  if (!target) notFound();
  permanentRedirect(target);
}
