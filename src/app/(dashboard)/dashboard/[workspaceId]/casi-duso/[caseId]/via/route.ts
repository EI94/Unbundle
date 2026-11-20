import type { NextRequest } from "next/server";
import { notFound, permanentRedirect } from "next/navigation";
import { viaRedirect } from "@/lib/uc/views/case-shell";

/**
 * (Rilascio 10, §3.5, F-043) «Via allo sviluppo» è una sezione della Panoramica: `/via` risponde 308 verso
 * `…/casi-duso/<caso>#via`, con la stessa query. La usano la campanella («via pronta», «via approvato», `bell.ts`)
 * e i link già partiti. Nessuna lettura del database: l'accesso lo controlla la Panoramica.
 *
 * È una route e non una pagina: sotto `casi-duso/loading.tsx` la risposta di una pagina parte in streaming e un
 * redirect diventerebbe un 200 con meta refresh (`loading.md`, «Status Codes»); la route risponde subito 308. Un'ancora
 * dell'indirizzo di prima non arriva al server: l'arrivo è sempre la sezione, `#via`.
 */
export function GET(request: NextRequest) {
  const target = viaRedirect(request.nextUrl.pathname, request.nextUrl.search);
  if (!target) notFound();
  permanentRedirect(target);
}
