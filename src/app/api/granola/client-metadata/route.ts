import { granolaConfig } from "@/lib/context/granola/config";
import { clientMetadataDocument } from "@/lib/context/granola/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Il documento di metadati del cliente OAuth di Unbundle per Granola (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md
 * §8.2). Unbundle è un cliente pubblico: il suo `client_id` è l'indirizzo di questo documento. Risponde senza sessione.
 *
 * L'origine è sempre quella pubblica (`NEXT_PUBLIC_APP_URL`), mai quella della richiesta: l'indirizzo senza `www`
 * reindirizza, e chi legge il documento può non seguire il reindirizzamento. Questo indirizzo non cambia più:
 * cambiarlo vuol dire un cliente nuovo e tutti da ricollegare. Con Granola spento: 404.
 */
export async function GET(): Promise<Response> {
  const config = granolaConfig(process.env);
  if (!config.available || !config.origin) {
    return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" } });
  }
  return Response.json(clientMetadataDocument(config.origin), { headers: { "Cache-Control": "public, max-age=3600" } });
}
