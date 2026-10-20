import type { Instrumentation } from "next";
import { areaForPath, digestOf, errorCodeOf, idsFromPath, pgCodeOf, redactUcPath, ucLog } from "@/lib/uc/log";

/**
 * Errori del server in una riga JSON (DESIGN §7.1 P0-6), per il log drain e
 * l'avviso sul tasso d'errore. Next la chiama per ogni errore catturato nelle
 * pagine, nelle rotte, nelle server action e nel proxy.
 *
 * Si registrano solo il tipo di rotta, lo schema della rotta, il percorso
 * ripulito (token di `/r/<token>` e `/api/r/<token>` riscritti in `[token]`,
 * niente query), codice, SQLSTATE e digest. Mai il messaggio dell'errore, le
 * intestazioni o il corpo della richiesta: possono contenere token, email o
 * valori del cliente.
 */
export const onRequestError: Instrumentation.onRequestError = (error, request, context) => {
  try {
    const path = redactUcPath(request.path);
    ucLog({
      level: "error",
      area: areaForPath(path),
      op: context.routeType,
      code: errorCodeOf(error),
      pgCode: pgCodeOf(error),
      digest: digestOf(error),
      route: path,
      ...idsFromPath(path),
    });
  } catch {
    // Il log non deve mai rompere la risposta.
  }
};
