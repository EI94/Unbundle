import { auth } from "@/lib/auth";
import { logSafeError } from "@/lib/log/safe-error";
import { BELL_TEXT, parseBellWriteBody, type BellWriteResult } from "@/lib/notifications/bell";
import { loadBellPayload } from "@/lib/notifications/bell-data";
import { writeBellRead, writeBellSeen } from "@/lib/notifications/bell-writes";
import { sameSiteRequest } from "@/lib/uc/export/test-cases-upload";
import { isUseCaseHubWorkspace } from "@/lib/use-cases/rollout";
import { getCollaboratorAccess } from "@/lib/workspace-access";

/**
 * La campanella di chi guarda (SPEC §P2.3.9). GET: il payload, senza scrivere niente. POST: le due
 * scritture frequenti, «l'ho aperta» e «ho aperto questa riga»; mai una server action, così non
 * aspettano dietro le altre action della pagina e non le ritardano. Nessun `revalidatePath`.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY = 1024;

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: HEADERS });
}

function failure(code: Extract<BellWriteResult, { ok: false }>["code"], message: string, status: number): Response {
  return json({ ok: false, code, message } satisfies BellWriteResult, status);
}

export async function GET(_req: Request, ctx: { params: Promise<{ workspaceId: string }> }): Promise<Response> {
  const { workspaceId } = await ctx.params;
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return json({ ok: false, code: "non_autenticato" }, 401);
  if (!UUID.test(workspaceId)) return json({ ok: false, code: "non_trovato" }, 404);
  try {
    const access = await getCollaboratorAccess(userId, workspaceId);
    if (!access) return json({ ok: false, code: "non_trovato" }, 404);
    const payload = await loadBellPayload({ workspaceId, userId, role: access.role ?? null, useCaseHub: isUseCaseHubWorkspace(workspaceId) });
    return json({ ok: true, payload });
  } catch (error) {
    logSafeError("bell", "lettura", error, { workspaceId });
    return failure("riprova", BELL_TEXT.errors.unavailable, 503);
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ workspaceId: string }> }): Promise<Response> {
  const { workspaceId } = await ctx.params;
  if (!sameSiteRequest(req.headers, process.env.NEXT_PUBLIC_APP_URL)) return failure("non_disponibile", BELL_TEXT.errors.unavailable, 403);
  const type = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (type !== "application/json") return failure("dati_non_validi", BELL_TEXT.errors.unavailable, 415);
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY) return failure("dati_non_validi", BELL_TEXT.errors.unavailable, 400);
  let parsed: unknown = null;
  try {
    const text = await req.text();
    if (new TextEncoder().encode(text).byteLength > MAX_BODY) return failure("dati_non_validi", BELL_TEXT.errors.unavailable, 400);
    parsed = JSON.parse(text);
  } catch {
    return failure("dati_non_validi", BELL_TEXT.errors.unavailable, 400);
  }
  const body = parseBellWriteBody(parsed);
  if (!body) return failure("dati_non_validi", BELL_TEXT.errors.unavailable, 400);

  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return failure("non_autenticato", BELL_TEXT.errors.session, 401);
  if (!UUID.test(workspaceId)) return failure("non_disponibile", BELL_TEXT.errors.unavailable, 404);
  const op = body.op === "seen" ? "visto" : "letta";
  try {
    const access = await getCollaboratorAccess(userId, workspaceId);
    if (!access) return failure("non_disponibile", BELL_TEXT.errors.unavailable, 404);
    if (body.op === "seen") {
      const seenAt = await writeBellSeen({ workspaceId, userId });
      return json({ ok: true, seenAt: seenAt.toISOString() } satisfies BellWriteResult);
    }
    const outcome = await writeBellRead({ workspaceId, userId, role: access.role ?? null, ref: body.ref });
    if (outcome !== "ok") return failure("non_disponibile", BELL_TEXT.errors.unavailable, 404);
    return json({ ok: true, seenAt: null } satisfies BellWriteResult);
  } catch (error) {
    logSafeError("bell", op, error, { workspaceId });
    return failure("riprova", body.op === "seen" ? BELL_TEXT.errors.unavailable : BELL_TEXT.errors.readOne, 503);
  }
}
