import { AGENT_VIEWER, contextActorForCli } from "@/lib/context/visibility";
import { CONTEXT_TEXT } from "@/lib/context/text";
import { askContext } from "@/lib/db/queries/context-ask";
import { contextStoreReady } from "@/lib/db/queries/context-store";
import { namesToHide } from "@/lib/db/queries/use-case-factory";
import { resolveCliCase } from "@/lib/use-cases/cli/case";
import { CLI_CASE_ONLY_ASK, CLI_CONTEXT_UNAVAILABLE } from "@/lib/use-cases/cli/case-errors";
import { askLimitFailure, askResponse, askTimeoutMs, cliContextFailure, type CliFailureSpec } from "@/lib/use-cases/cli/context-commands";
import { cliError, cliJson, openCli, readCliBody } from "@/lib/use-cases/cli/route-kit";
import { givenNames, nameTokens, redact } from "@/lib/use-cases/factory/package";

/**
 * `unbundle contesto <ID> "domanda"` (rilascio 9b, docs/contesto/RILASCIO-9b-COSTRUZIONE.md §2.5, D13): una domanda sul
 * cliente, con le fonti (`askContext`), per chi legge il caso.
 *
 * - **Sempre come chi non è di Lateral Space** (`AGENT_VIEWER`, D1): solo i fatti e i documenti «Per tutti» e i dati della
 *   Discovery; mai appunti, risposte dei referenti o decisioni, anche quando chiede Lateral Space. I tetti sono quelli di
 *   «Chiedi al contesto», per la persona del token e per il workspace.
 * - Il modello solo con l'ok del cliente ai fornitori di AI (lo controlla `askContext`); senza, i brani trovati.
 * - **Dentro i 60 secondi della CLI**, che non riprova: al modello al più 40 secondi, mai oltre i 50 dall'arrivo.
 * - Troppe domande: 429 `limite` con `Retry-After`. I nomi che Unbundle conosce diventano «una persona».
 *
 * `{ caso, domanda }` → `{ testo, dati: { stato, risposta, fonti } }`.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

const failure = (f: CliFailureSpec) => cliError(f.status, f.code, f.message, f.headers);

export async function POST(request: Request): Promise<Response> {
  const started = Date.now();
  const opened = await openCli(request, { method: "POST", write: false });
  if (!opened.ok) return opened.response;
  const read = await readCliBody(request);
  if (!read.ok) return read.response;
  const resolved = await resolveCliCase(opened.value, read.body.caso);
  if (!resolved.ok) return resolved.response;
  const c = resolved.value;
  // (8.0d, D7) «Solo questo use case» non fa domande sulla memoria del cliente (cerca in tutta l'azienda): legge i fatti
  // legati al suo caso con lo strato `contesto`.
  if (c.caseOnly) return cliError(403, "solo_questo_caso", CLI_CASE_ONLY_ASK(c.useCase.code));
  if (!(await contextStoreReady())) return failure(CLI_CONTEXT_UNAVAILABLE);
  const { principal, executor } = opened.value;
  // D1: la persona del token, ma con gli occhi di chi non è di Lateral Space. I limiti restano i suoi.
  const actor = contextActorForCli({ workspaceId: principal.workspaceId, userId: principal.userId, role: AGENT_VIEWER.role, isLateralSpace: AGENT_VIEWER.isLateralSpace });
  const question = typeof read.body.domanda === "string" ? read.body.domanda : "";
  const [result, names] = await Promise.all([askContext(actor, question, { timeoutMs: askTimeoutMs(Date.now() - started) }), namesToHide(executor, c.target)]);
  if (!result.ok) return failure(cliContextFailure(result, { retryMessage: CONTEXT_TEXT.ask.failed }));
  const answer = result.value;
  if (answer.status === "limite") return failure(askLimitFailure(answer.retryAfterSeconds));
  const tokens = nameTokens(names);
  const given = givenNames(names);
  return cliJson(askResponse(answer, (text) => redact(text, tokens, given)));
}
