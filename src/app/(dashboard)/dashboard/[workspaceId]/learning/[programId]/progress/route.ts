import type { NextRequest } from "next/server";
import { notFound, permanentRedirect } from "next/navigation";
import { progressTarget } from "@/lib/learning/moved-routes";

/**
 * (Rilascio 10, ondata 7a, PROPOSTA-10 §2.4) «Il mio risultato» non è più una pagina: gli esiti sono in «Esercizi»
 * della pagina del corso, lo storico in «Tutte le prove». 308 verso il corso sulla piega (`#prove`), con la query di
 * prima. Nessuna lettura del database: la pagina del corso controlla chi entra.
 *
 * È una route e non una pagina: sotto `learning/loading.tsx` la risposta di una pagina parte in streaming e un redirect
 * diventerebbe un 200 con una meta refresh; la route risponde subito 308.
 */
export function GET(request: NextRequest) {
  const target = progressTarget(request.nextUrl.pathname, request.nextUrl.searchParams);
  if (!target) notFound();
  permanentRedirect(target);
}
