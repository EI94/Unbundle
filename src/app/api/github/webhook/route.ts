import { after } from "next/server";
import { ensureDbSchema } from "@/lib/db/ensure-schema";
import { dispatchDue } from "@/lib/db/queries/uc-notifications-dispatch";
import { applyGithubEvent } from "@/lib/db/queries/use-case-github";
import { getAppUcExecutor } from "@/lib/db/uc-executor";
import { ucLogError } from "@/lib/uc/log";
import { GITHUB_BODY_MAX_BYTES, GITHUB_DELIVERY_RE, githubEventName, githubPayloadText, parseGithubEvent, verifyGithubSignature } from "@/lib/use-cases/factory/github";

/**
 * Il webhook di GitHub (rilascio 8.1b, docs/rilascio-8/RILASCIO-8.1-COSTRUZIONE.md §2, 8.1b): pull request e push dei
 * repository della fabbrica aggiornano da soli lo stato dei compiti (`applyGithubEvent`).
 *
 * - **Spento** finché non c'è `GITHUB_WEBHOOK_SECRET` (solo Production su Vercel): risponde 404.
 * - **Firmato:** senza `X-Hub-Signature-256` giusta per il corpo, 401, e non si legge niente.
 * - **Una volta sola:** `X-GitHub-Delivery` si registra con gli effetti; un evento rimandato risponde «ripetuto».
 * - Mai il contenuto nei log: solo l'esito.
 * - Il tipo di contenuto giusto è `application/json`; il modulo predefinito di GitHub (`payload=…`) va bene lo stesso.
 *
 * Va bene sia il webhook dell'organizzazione sia, più avanti, quello di un'app GitHub: stesso formato, stessa firma.
 */
export const runtime = "nodejs";
export const maxDuration = 30;

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.GITHUB_WEBHOOK_SECRET?.trim() ?? "";
  if (!secret) return json(404, { ok: false });

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > GITHUB_BODY_MAX_BYTES) return json(413, { ok: false, errore: "troppo_grande" });
  const body = new Uint8Array(await request.arrayBuffer());
  if (body.byteLength > GITHUB_BODY_MAX_BYTES) return json(413, { ok: false, errore: "troppo_grande" });
  if (!verifyGithubSignature(secret, body, request.headers.get("x-hub-signature-256"))) return json(401, { ok: false, errore: "firma" });

  const event = githubEventName(request.headers.get("x-github-event"));
  const deliveryId = request.headers.get("x-github-delivery") ?? "";
  if (!event || !GITHUB_DELIVERY_RE.test(deliveryId)) return json(400, { ok: false, errore: "intestazioni" });
  let payload: unknown;
  try {
    const text = githubPayloadText(request.headers.get("content-type"), new TextDecoder().decode(body));
    if (text === null) return json(400, { ok: false, errore: "json" });
    payload = JSON.parse(text);
  } catch {
    return json(400, { ok: false, errore: "json" });
  }

  try {
    await ensureDbSchema();
    const executor = await getAppUcExecutor();
    const result = await applyGithubEvent(executor, { deliveryId, event, parsed: parseGithubEvent(event, payload) });
    if (result.esito === "non_disponibile") return json(503, { ok: false, errore: "non_disponibile" });
    if (result.esito === "applicato") {
      const caseIds = [...new Set(result.casi.map((c) => c.caseId).filter((id): id is string => Boolean(id)))];
      if (caseIds.length) {
        after(async () => {
          for (const caseId of caseIds) {
            try {
              await dispatchDue({ caseId });
            } catch (error) {
              ucLogError({ area: "github", op: "email_pr" }, error);
            }
          }
        });
      }
      return json(200, { ok: true, esito: "applicato", compiti: result.casi.map((c) => ({ compito: c.compito, stato: c.stato })) });
    }
    return json(200, { ok: true, esito: result.esito, ...(result.esito === "ignorato" ? { motivo: result.motivo } : {}) });
  } catch (error) {
    ucLogError({ area: "github", op: "webhook" }, error);
    return json(500, { ok: false, errore: "interno" });
  }
}
