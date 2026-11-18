import { after } from "next/server";
import { contextActorForCli } from "@/lib/context/visibility";
import { AGENT_CONTEXT_TEXT } from "@/lib/context/work/agent-text";
import { contextAiConsent } from "@/lib/db/queries/context-consent";
import { readContextSource } from "@/lib/db/queries/context-read";
import { addContextNote } from "@/lib/db/queries/context-sources";
import { contextWorkReady } from "@/lib/db/queries/context-store";
import { logSafeError } from "@/lib/log/safe-error";
import { executeCliWrite } from "@/lib/use-cases/cli/case";
import { CLI_CONTEXT_UNAVAILABLE } from "@/lib/use-cases/cli/case-errors";
import {
  CLI_NOTE_BODY_BYTES,
  cliContextFailure,
  noteResponse,
  parseNoteBody,
  type CliFailureSpec,
  type NoteRecord,
} from "@/lib/use-cases/cli/context-commands";
import { cliError, cliJson, cliPublicOrigin, isCliLateralSpace, openCli, readCliBody } from "@/lib/use-cases/cli/route-kit";
import { romeToday } from "@/lib/use-cases/quarter";

/**
 * `unbundle nota <file> --titolo "…" [--data …] [--con-chi "…"] [--link …]` (rilascio 9b, docs/contesto/RILASCIO-9b-
 * COSTRUZIONE.md §2.5, D11): gli appunti di una call nel contesto del cliente.
 *
 * - **Solo Lateral Space**, con qualunque token del workspace: lo dice l'e-mail verificata della persona, riletta adesso
 *   (`isCliLateralSpace`); agli altri 403 `solo_lateral_space`.
 * - **Al massimo 600 KB di testo** (i byte di `testo`, non il corpo JSON, che pesa di più): oltre, 413. Un PDF, o un testo
 *   con caratteri nulli, 422. Titolo, data, lunghezze, link e dati sanitari li controlla `addContextNote` (422).
 * - Salva un appunto con origine `cli` e risponde subito; con l'ok del cliente ai fornitori di AI la lettura parte sul
 *   server dopo la risposta (`after()`, al massimo 90 secondi), altrimenti la fanno la notte o la pagina.
 * - Con `Idempotency-Key`: la stessa richiesta ripetuta risponde come la prima e non salva due volte. Gli stessi appunti
 *   già salvati (lo stesso testo) rispondono «ci sono già».
 * - Senza la 0041 (l'origine `cli` non c'è ancora): 503, da riprovare.
 *
 * `{ titolo, data?, testo, conChi?, link? }` → `{ testo, dati: { fonte, nuova, link } }`.
 */
export const runtime = "nodejs";
export const maxDuration = 120;

const failure = (f: CliFailureSpec) => cliError(f.status, f.code, f.message, f.headers);

export async function POST(request: Request): Promise<Response> {
  const opened = await openCli(request, { method: "POST", write: true, maxBytes: CLI_NOTE_BODY_BYTES });
  if (!opened.ok) return opened.response;
  // Prima di leggere un corpo grande: gli appunti li aggiunge solo Lateral Space (OpenedCli.access non lo dice).
  if (!(await isCliLateralSpace(opened.value))) return cliError(403, "solo_lateral_space", AGENT_CONTEXT_TEXT.note.lsOnly);
  const read = await readCliBody(request, CLI_NOTE_BODY_BYTES);
  if (!read.ok) return read.response;
  const parsed = parseNoteBody(read.body, romeToday());
  if (!parsed.ok) return failure(parsed.failure);
  if (!(await contextWorkReady())) return failure(CLI_CONTEXT_UNAVAILABLE);
  const { principal, access } = opened.value;
  const actor = contextActorForCli({ workspaceId: principal.workspaceId, userId: principal.userId, role: access.role, isLateralSpace: true });
  const note = parsed.value;
  // Un no di `addContextNote` (dati non validi, guasto) libera la chiave; la risposta è quella di «Contesto» (422, 503).
  const refusal: { spec: CliFailureSpec | null } = { spec: null };
  const outcome = await executeCliWrite<NoteRecord>(opened.value, request.headers.get("idempotency-key")?.trim() ?? "", "nota", read.body, async () => {
    const saved = await addContextNote(actor, { ...note, origin: "cli" });
    if (!saved.ok) {
      refusal.spec = cliContextFailure(saved);
      return { ok: false, code: refusal.spec.code, message: refusal.spec.message };
    }
    return { ok: true, value: { fonte: saved.value.sourceId, nuova: saved.value.created } };
  });
  if (!outcome.ok) {
    if (refusal.spec) return failure(refusal.spec);
    return cliError(outcome.status, outcome.code, outcome.message, outcome.retryAfterSeconds === undefined ? {} : { "Retry-After": String(outcome.retryAfterSeconds) });
  }
  const record = outcome.value;
  const consent = await contextAiConsent(principal.workspaceId);
  // La lettura dopo la risposta, una volta sola: solo per appunti nati adesso e con l'ok. Il resto lo legge la notte.
  if (record.nuova && consent && !outcome.repeated) {
    after(async () => {
      try {
        const result = await readContextSource(actor, record.fonte);
        if (!result.ok) logSafeError("cli", "nota_non_letta", null, { workspaceId: principal.workspaceId, sourceId: record.fonte, esito: result.error });
      } catch (error) {
        logSafeError("cli", "nota_non_letta", error, { workspaceId: principal.workspaceId, sourceId: record.fonte });
      }
    });
  }
  const response = noteResponse(record, { consent, origin: cliPublicOrigin(request), workspaceId: principal.workspaceId });
  return cliJson(outcome.repeated ? { ...response, ripetuta: true } : response);
}
