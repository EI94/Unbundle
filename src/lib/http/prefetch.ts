/**
 * Una richiesta di prefetch del browser o del router di Next.
 *
 * Un GET che registra qualcosa non deve scattare quando un link viene solo
 * pre-caricato: è così che erano comparse 24 righe di «Export audit» mai
 * richieste da nessuno. Le rotte con effetti collaterali saltano l'effetto
 * quando questa funzione risponde true.
 */
export function isPrefetchRequest(request: Request) {
  const headers = request.headers;
  return (
    headers.get("next-router-prefetch") === "1" ||
    headers.get("sec-purpose")?.includes("prefetch") === true ||
    headers.get("purpose") === "prefetch" ||
    headers.get("x-purpose") === "prefetch"
  );
}
