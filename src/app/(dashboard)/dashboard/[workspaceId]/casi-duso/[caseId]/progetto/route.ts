import type { NextRequest } from "next/server";
import { notFound, permanentRedirect } from "next/navigation";
import { legacyCaseRouteFromPath } from "@/lib/uc/views/legacy-routes";

/**
 * (Rilascio 10, §3.5, §8.2, F-011, F-131) «Progetto dell'agente» è la Costruzione: `/progetto` risponde 308 verso
 * `/costruzione` con la stessa query, senza leggere il database (l'accesso lo controlla la Costruzione). Lo usano le
 * e-mail e la campanella (`dispatch.ts`, `bell.ts`), l'Agent Factory, la CLI e il MCP (`…/use-cases/<id>/progetto#banco`
 * passa da qui). Le ancore (`#banco`, `#compiti`, `#contesto`) non arrivano al server: il 308 non ne mette, così il
 * browser tiene quella di prima, e la Costruzione ha ancora quegli id.
 *
 * È una route e non una pagina: sotto `casi-duso/loading.tsx` la risposta di una pagina parte in streaming e un
 * redirect diventerebbe un 200 con meta refresh (`loading.md`, «Status Codes»); la route risponde subito 308.
 */
export function GET(request: NextRequest) {
  const target = legacyCaseRouteFromPath(request.nextUrl.pathname, request.nextUrl.searchParams);
  if (!target) notFound();
  permanentRedirect(target);
}
