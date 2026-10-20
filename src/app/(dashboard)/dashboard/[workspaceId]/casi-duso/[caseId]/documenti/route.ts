import type { NextRequest } from "next/server";
import { notFound, permanentRedirect } from "next/navigation";
import { legacyCaseRouteFromPath } from "@/lib/uc/views/legacy-routes";

/**
 * Vecchio indirizzo del dossier (DESIGN §2.5): 308 verso la pagina nuova, con
 * la query tradotta da `legacyCaseRoute`. Nessuna lettura del database.
 *
 * È una route e non una pagina: sotto `casi-duso/loading.tsx` la risposta di una
 * pagina parte in streaming e un redirect diventerebbe un 200 con meta refresh
 * (`loading.md`, «Status Codes»); la route risponde subito 308.
 */
export function GET(request: NextRequest) {
  const target = legacyCaseRouteFromPath(request.nextUrl.pathname, request.nextUrl.searchParams);
  if (!target) notFound();
  permanentRedirect(target);
}
