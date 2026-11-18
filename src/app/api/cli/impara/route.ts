import { contextActorForCli } from "@/lib/context/visibility";
import { addLearning } from "@/lib/db/queries/context-learning";
import { contextWorkReady } from "@/lib/db/queries/context-store";
import { executeCliWrite, requireCliWrite, resolveCliCase } from "@/lib/use-cases/cli/case";
import { CLI_CONTEXT_UNAVAILABLE } from "@/lib/use-cases/cli/case-errors";
import {
  cliContextFailure,
  learnLimitFailure,
  learnRecord,
  learnResponse,
  parseLearnBody,
  type CliFailureSpec,
  type LearnRecord,
} from "@/lib/use-cases/cli/context-commands";
import { cliError, cliJson, isCliLateralSpace, openCli, readCliBody } from "@/lib/use-cases/cli/route-kit";

/**
 * `unbundle impara <ID> "…" [--sezione sistemi] --si` (rilascio 9b, docs/contesto/RILASCIO-9b-COSTRUZIONE.md §2.5, D10):
 * una cosa imparata costruendo il caso, sul lavoro del cliente. Nessun modello.
 *
 * - **Chi costruisce il caso** (Lateral Space e da fuori, `requireCliWrite`), **solo dopo il sì della persona**:
 *   `confermato: true`, che la CLI manda solo con `--si`; senza, 400 `conferma`.
 * - Diventa una proposta «Solo Lateral Space» in «Da confermare», mai preselezionata (`addLearning`): Lateral Space la
 *   controlla prima che entri nella memoria del cliente. La stessa frase di un fatto attivo è una riconferma; la stessa
 *   frase di una proposta aperta non scrive niente.
 * - Una sezione che non c'è: 400 `sezione` con l'elenco. Nomi, e-mail, dati sanitari, frase troppo lunga: 422. Il tetto
 *   del giorno (30 per workspace): 429 `limite` con `Retry-After`. Senza la 0041: 503.
 * - Con `Idempotency-Key`: la stessa richiesta ripetuta risponde come la prima. Un no (422, 429) libera la chiave.
 *
 * `{ caso, testo, sezione?, confermato: true }` → `{ testo, dati: { esito, proposta } }`.
 */
export const runtime = "nodejs";

const failure = (f: CliFailureSpec) => cliError(f.status, f.code, f.message, f.headers);

export async function POST(request: Request): Promise<Response> {
  const opened = await openCli(request, { method: "POST", write: true });
  if (!opened.ok) return opened.response;
  const read = await readCliBody(request);
  if (!read.ok) return read.response;
  const parsed = parseLearnBody(read.body);
  if (!parsed.ok) return failure(parsed.failure);
  const resolved = await resolveCliCase(opened.value, read.body.caso);
  if (!resolved.ok) return resolved.response;
  const c = resolved.value;
  const denied = requireCliWrite(c);
  if (denied) return denied;
  if (!(await contextWorkReady())) return failure(CLI_CONTEXT_UNAVAILABLE);
  const { principal, access } = opened.value;
  // La persona del token, canale «cli», con Lateral Space dall'e-mail verificata: decide quali fatti vede per la riconferma.
  const actor = contextActorForCli({ workspaceId: principal.workspaceId, userId: principal.userId, role: access.role, isLateralSpace: await isCliLateralSpace(opened.value) });
  const learn = parsed.value;
  // Un no di `addLearning` (dati non validi, tetto del giorno, guasto) libera la chiave; la risposta è la sua.
  const refusal: { spec: CliFailureSpec | null } = { spec: null };
  const refuse = (spec: CliFailureSpec) => {
    refusal.spec = spec;
    return { ok: false as const, code: spec.code, message: spec.message };
  };
  const outcome = await executeCliWrite<LearnRecord>(
    opened.value,
    request.headers.get("idempotency-key")?.trim() ?? "",
    "impara",
    { caso: c.useCase.code, testo: learn.text, sezione: learn.section ?? null },
    async () => {
      const learned = await addLearning(actor, { useCaseId: c.useCase.id, code: c.useCase.code, text: learn.text, section: learn.section });
      if (!learned.ok) return refuse(cliContextFailure(learned));
      if (learned.value.esito === "limite") return refuse(learnLimitFailure(learned.value.retryAfterSeconds));
      return { ok: true, value: learnRecord(learned.value) };
    },
  );
  if (!outcome.ok) {
    if (refusal.spec) return failure(refusal.spec);
    return cliError(outcome.status, outcome.code, outcome.message, outcome.retryAfterSeconds === undefined ? {} : { "Retry-After": String(outcome.retryAfterSeconds) });
  }
  const response = learnResponse(outcome.value);
  return cliJson(outcome.repeated ? { ...response, ripetuta: true } : response);
}
