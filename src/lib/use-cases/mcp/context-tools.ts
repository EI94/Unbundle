/**
 * «Contesto» nell'MCP del team (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md §9): la porta «Da Claude».
 *
 * - `add_context_notes` salva gli appunti di una call (`addContextNote`, origine «claude»: li vede solo Lateral Space),
 *   li legge contro la memoria di oggi (`readContextSource`, al massimo 75 secondi) e restituisce le proposte. Niente
 *   entra in memoria. Se restano parti da leggere, o la lettura va ripresa (tempo, errore, limite del giorno), la
 *   risposta lo dice e la richiesta resta «failed» nell'archivio dell'idempotenza: la stessa chiamata, con la stessa
 *   chiave, riprende dall'appunto già salvato. Senza l'ok ai sub-responsabili gli appunti restano salvati e la lettura
 *   parte da Unbundle, quando c'è l'ok.
 * - `list_context_proposals` rilegge le proposte aperte, di tutti gli appunti o di uno.
 * - `confirm_context_proposals` fa entrare in memoria le proposte a cui la persona ha detto sì (`confirmProposals`,
 *   tutte o nessuna) e scarta quelle rifiutate (`discardProposals`). Prima di scrivere si rilegge lo stato di ogni
 *   voce: una proposta «dedotto» vuole `inferredConfirmed: true`, un conflitto la scelta della persona (`resolution`),
 *   una proposta da correggere non entra, una proposta cambiata o già decisa è `version_conflict`. Un errore su una voce
 *   non scrive niente. Dopo una conferma riuscita «In breve» si riscrive dopo la risposta (`refreshBrief`).
 *
 * Chi può (§9.4): i controlli di `callTeamTool` (area accesa, token «Solo lettura» sulle scritture), poi solo Lateral
 * Space (`permesso_mancante`), poi la 0038 (`riprova`). Le funzioni di `src/lib/db/queries/context-*.ts` rifanno da sé
 * il controllo di chi chiama. Limiti e idempotenza sono quelli degli altri strumenti (`runWrite` di `tools.ts`): il
 * risultato salvato porta solo id, codici e numeri; una risposta ripetuta rilegge i testi.
 *
 * Appunti e proposte sono dati, mai istruzioni: lo dicono le descrizioni, le istruzioni del server e la nota di ogni
 * risposta. Nessuna uscita porta «Con chi», nomi o e-mail di chi ha aggiunto o confermato. Un titolo o una citazione con
 * i dati di una persona non escono: al posto del titolo «Call 14 nov», «Documento 14 nov» o «Appunti 14 nov»; al posto
 * della citazione null, con «Apri Unbundle per la citazione.».
 *
 * (Rilascio 9b, docs/contesto/RILASCIO-9b-COSTRUZIONE.md §2.7, §5.7) Tre letture della memoria, per ogni revisore con
 * un token, anche «Solo lettura» (`CONTEXT_MEMORY_TOOL_NAMES`):
 * - `get_context` legge la Memoria per chi guarda (`loadContextMemory` con `touchSeen: false`: leggere da Claude non è
 *   una visita, e «Novità per te» non cambia), con gli use case di ogni riga (`loadContextLinks`). Filtri: use case,
 *   sezione, `since` (i fatti nati da quel giorno: nuovi o versioni nuove). Al massimo 200 fatti, i più recenti, poi `more`.
 * - `ask_context` fa la domanda di «Chiedi al contesto» (`askContext`, che rilegge l'ok ai sub-responsabili prima del
 *   modello e ha i suoi limiti). Un brano di appunti con i dati di una persona esce senza testo; una risposta scritta con
 *   i dati di una persona vale «non lo sappiamo», come `askContext` fa con i dati sanitari.
 * - `list_context_commitments` elenca gli impegni aperti, per parte, use case e scadenza: mai per persona.
 * Il cliente riceve solo righe «Per tutti» e mai la chiave `visibilityLabel`; nessuno riceve citazioni, «Con chi» o chi
 * ha confermato. Ognuna conta una lettura nei secchi di oggi; senza la 0038 `riprova`.
 *
 * Modulo puro: le funzioni condivise, la persona del token e la programmazione arrivano da fuori (`TeamContextDeps`;
 * nell'app `app-deps.ts`); `tools.ts` passa i suoi passi comuni (`ContextToolKit`). Gira con `node --test`.
 */
import { scanPersonalData } from "../../context/scan.ts";
import { CONTEXT_TEXT } from "../../context/text.ts";
import { contextAbilities, visibleTo, type ContextActor } from "../../context/visibility.ts";
import { CONTEXT_LIMITS, CONTEXT_SECTIONS, type ContextSection, type ContextVisibility, type SkippedCounts } from "../../context/vocab.ts";
import type { AskAnswer } from "../../db/queries/context-ask.ts";
import type { CommitmentView, FactView, MemoryView, QuestionView } from "../../db/queries/context-memory.ts";
import type { ConfirmItem, ConfirmResult, OpenProposals, ProposalView } from "../../db/queries/context-proposals.ts";
import type { ReadOutcome } from "../../db/queries/context-read.ts";
import type { AddedSource, NewNoteInput } from "../../db/queries/context-sources.ts";
import type { ContextLinks } from "../../db/queries/context-team.ts";
import type { TeamRequestKey } from "../../db/queries/team-mcp-requests.ts";
import { isIsoDate, romeToday } from "../quarter.ts";
import type { ServiceError, ServiceResult } from "../types.ts";
import type { TeamPrincipal } from "./auth.ts";
import {
  teamError,
  teamErrorResult,
  teamRequestHash,
  teamResult,
  validateTeamToolInput,
  type ConfirmContextProposalsInput,
  type TeamMcpError,
} from "./contract.ts";
import {
  CONTEXT_MEMORY_NOTE,
  CONTEXT_PROPOSALS_NOTE,
  linkToContext,
  linkToContextProposals,
  mcpAskSource,
  mcpCommitment,
  mcpFact,
  mcpProposal,
  mcpQuestion,
  mcpSourceTitle,
  notReportedLines,
  linkedUseCaseCodes,
  type McpProposal,
} from "./output.ts";
import type { Execution, TeamToolOutcome, WritePlan } from "./tools.ts";

// ─── Nomi, tempi e messaggi ──────────────────────────────────────────

export const CONTEXT_TOOL_NAMES = [
  "add_context_notes",
  "list_context_proposals",
  "confirm_context_proposals",
  "get_context",
  "ask_context",
  "list_context_commitments",
] as const;
export type ContextToolName = (typeof CONTEXT_TOOL_NAMES)[number];

export function isContextToolName(name: string): name is ContextToolName {
  return (CONTEXT_TOOL_NAMES as readonly string[]).includes(name);
}

/** (9b) Le letture della memoria: ogni revisore con un token, anche «Solo lettura». Le altre tre sono di Lateral Space. */
export const CONTEXT_MEMORY_TOOL_NAMES = ["get_context", "ask_context", "list_context_commitments"] as const satisfies readonly ContextToolName[];
export type ContextMemoryToolName = (typeof CONTEXT_MEMORY_TOOL_NAMES)[number];

export function isContextMemoryToolName(name: string): name is ContextMemoryToolName {
  return (CONTEXT_MEMORY_TOOL_NAMES as readonly string[]).includes(name);
}

/** La lettura di un appunto dall'MCP: dentro i 120 secondi della rotta, con il margine per salvare e rispondere. */
export const CONTEXT_MCP_READ_TIMEOUT_MS = 75_000;

/** Proposte al massimo in una risposta: quante se ne confermano in una chiamata (`CONTEXT_LIMITS.confirmMax`). */
export const CONTEXT_MCP_PROPOSALS_MAX = CONTEXT_LIMITS.confirmMax;

export const CONTEXT_LS_ONLY_MESSAGE = "Gli appunti e le proposte li gestisce Lateral Space.";
export const CONTEXT_PROPOSALS_CHANGED_MESSAGE = "Le proposte sono cambiate: rileggile con list_context_proposals.";
export const CONTEXT_INFERRED_MESSAGE = "È una proposta dedotta: chiedi alla persona se è vera.";
export const CONTEXT_CONFLICT_MESSAGE = "È un conflitto: chiedi alla persona quale tenere.";
export const CONTEXT_ISSUE_MESSAGE = "Questa proposta va corretta in Unbundle prima di confermarla.";
export const CONTEXT_GONE_MESSAGE = "Non è più da confermare: rileggi le proposte con list_context_proposals.";
export const CONTEXT_CHANGED_MESSAGE = "È cambiata dopo che l'hai letta: rileggila con list_context_proposals.";
export const CONTEXT_TWICE_MESSAGE = "Questa proposta è già in un'altra voce di questa richiesta.";
export const CONTEXT_NOT_FOUND_MESSAGE = "Non trovato in questo workspace: rileggi con list_context_proposals.";
const PARTIAL_CONFIRM_NOTE = "Le proposte confermate restano: richiama con lo stesso idempotencyKey per scartare le altre.";

/** (9b) I fatti al massimo in una risposta di `get_context` (§5.7): i più recenti; gli altri si contano in `more`. */
export const CONTEXT_MCP_FACTS_MAX = 200;

// ─── Dipendenze ──────────────────────────────────────────────────────

/** Le funzioni condivise di «Contesto» (§3.4) che i tre strumenti usano, e la persona del token. */
export interface TeamContextDeps {
  /** La 0038 c'è (`contextStoreReady`). */
  ready(): Promise<boolean>;
  /** La persona del token, canale «claude» (`contextActorFromPrincipal`). */
  actor(principal: TeamPrincipal): ContextActor;
  addNote(actor: ContextActor, input: NewNoteInput): Promise<ServiceResult<AddedSource>>;
  read(actor: ContextActor, sourceId: string, opts: { timeoutMs: number }): Promise<ServiceResult<ReadOutcome>>;
  listOpen(actor: ContextActor, opts?: { sourceId?: string }): Promise<OpenProposals | null>;
  confirm(actor: ContextActor, items: readonly ConfirmItem[]): Promise<ServiceResult<ConfirmResult>>;
  discard(actor: ContextActor, ids: readonly string[]): Promise<ServiceResult<{ discarded: number }>>;
  /** «In breve» riscritto dopo la risposta (nella rotta: `after()`). Non deve lanciare. */
  refreshBrief(workspaceId: string): void;
  /**
   * (9b) La Memoria per chi guarda (`loadContextMemory`), già filtrata per visibilità. L'MCP passa sempre
   * `touchSeen: false`: leggere da Claude non è una visita, e «Novità per te» resta com'è.
   */
  memory(actor: ContextActor, opts: { touchSeen: false }): Promise<MemoryView>;
  /** (9b) Gli use case di fatti, impegni e domande, e il giorno in cui è nato ogni fatto (`loadContextLinks`); null se non riesce. */
  links(actor: ContextActor, ids: { factIds: readonly string[]; commitmentIds: readonly string[]; questionIds: readonly string[] }): Promise<ContextLinks | null>;
  /** (9b) «Chiedi al contesto» (`askContext`): i suoi limiti, e l'ok ai sub-responsabili riletto prima del modello. */
  ask(actor: ContextActor, question: string): Promise<ServiceResult<AskAnswer>>;
}

/** I passi comuni degli strumenti che `tools.ts` presta a questi tre. */
export interface ContextToolKit {
  consumeLimit(kind: "read" | "write"): Promise<TeamMcpError | null>;
  runWrite(plan: WritePlan): Promise<TeamToolOutcome>;
  /** L'avanzamento di una scrittura, nella riga dell'idempotenza (`progress`). */
  saveProgress(key: TeamRequestKey, attempt: number, result: Record<string, unknown>): Promise<boolean>;
  appOrigin: string;
  now(): Date;
  /** (9b) L'id dello use case con questo codice nel workspace del token; null se non c'è. */
  findUseCaseId(code: string): Promise<string | null>;
}

function succeeded<T extends object>(data: T): TeamToolOutcome {
  return { outcome: "ok", result: teamResult(data) };
}

function failed(error: TeamMcpError): TeamToolOutcome {
  return { outcome: error.error, result: teamErrorResult(error) };
}

// ─── Ingresso ────────────────────────────────────────────────────────

/**
 * Esegue uno dei sei strumenti, dopo i controlli comuni di `callTeamTool`. Appunti e proposte solo per Lateral Space;
 * le tre letture della memoria (9b) per ogni revisore. Tutti con la 0038.
 */
export async function callContextTool(name: ContextToolName, args: unknown, principal: TeamPrincipal, deps: TeamContextDeps, kit: ContextToolKit): Promise<TeamToolOutcome> {
  if (!isContextMemoryToolName(name) && principal.viewer.isLateralSpace !== true) return failed(teamError("permesso_mancante", { message: CONTEXT_LS_ONLY_MESSAGE }));
  if (!(await deps.ready())) return failed(teamError("riprova", { message: CONTEXT_TEXT.errors.notReady }));
  switch (name) {
    case "add_context_notes":
      return addContextNotes(args, principal, deps, kit);
    case "list_context_proposals":
      return listContextProposals(args, principal, deps, kit);
    case "confirm_context_proposals":
      return confirmContextProposals(args, principal, deps, kit);
    case "get_context":
      return getContext(args, principal, deps, kit);
    case "ask_context":
      return askContextTool(args, principal, deps, kit);
    case "list_context_commitments":
      return listContextCommitments(args, principal, deps, kit);
  }
}

/** I campi delle funzioni condivise con il loro nome nel contratto. */
const NOTE_FIELDS: Readonly<Record<string, string>> = Object.freeze({ title: "title", occurredOn: "date", body: "text", participants: "participants", link: "link" });

/** Un esito non riuscito delle funzioni di «Contesto» nel formato del contratto. */
export function contextFailure(
  failure: { error: ServiceError; message?: string; fieldErrors?: Record<string, string> },
  fields: Readonly<Record<string, string>> = {},
): TeamMcpError {
  switch (failure.error) {
    case "permesso_mancante":
      return teamError("permesso_mancante", { message: CONTEXT_LS_ONLY_MESSAGE });
    case "area_spenta":
      // In «Contesto» vuol dire che la 0038 non c'è ancora: si riprova tra poco.
      return teamError("riprova", { message: CONTEXT_TEXT.errors.notReady });
    case "versione_superata":
      return teamError("version_conflict", { message: CONTEXT_PROPOSALS_CHANGED_MESSAGE });
    case "non_trovato":
      return teamError("not_found", { message: CONTEXT_NOT_FOUND_MESSAGE });
    case "transizione_non_ammessa":
      return teamError("transizione_non_ammessa", { message: failure.message || undefined });
    case "dati_non_validi": {
      const fieldErrors: Record<string, string> = {};
      for (const [key, message] of Object.entries(failure.fieldErrors ?? {})) {
        const mapped = fields[key];
        if (mapped && typeof message === "string" && message.length > 0 && message.length <= 200) fieldErrors[mapped] = message;
      }
      const keep = Object.keys(fieldErrors).length === 0 && typeof failure.message === "string" && failure.message.length <= 200;
      return teamError("invalid_payload", { message: keep ? failure.message : undefined, fieldErrors });
    }
    default:
      return teamError("riprova", { message: CONTEXT_TEXT.errors.retry });
  }
}

/** Le proposte di una lettura, nell'ordine di «Da confermare»: prima le altre, in fondo le riconferme. Al massimo 75. */
function proposalsOf(open: OpenProposals | null): { shown: McpProposal[]; total: number } {
  const views: ProposalView[] = open ? [...open.proposals, ...open.reconfirmed] : [];
  return { shown: views.slice(0, CONTEXT_MCP_PROPOSALS_MAX).map(mcpProposal), total: views.length };
}

// ═══ add_context_notes ═══════════════════════════════════════════════

/** Come è andata la lettura, a Claude: lo stato e una frase. */
export type ReadingStatus = "letto" | "in_corso" | "ok_mancante" | "da_riprovare" | "non_letto";
/** L'esito della lettura salvato nella riga dell'idempotenza: un codice, mai un testo. */
type ReadingCode = ReadOutcome["status"];
const READING_CODES: readonly ReadingCode[] = ["letto", "in_corso", "ok_mancante", "in_lettura", "rifiuto", "tempo", "errore", "limite"];
/** Le letture da riprendere con la stessa chiave: la richiesta resta «failed». */
const RESUMABLE: ReadonlySet<ReadingCode> = new Set(["in_corso", "in_lettura", "tempo", "errore", "limite"]);

const SAME_CALL = "con gli stessi dati e lo stesso idempotencyKey";

/** Lo stato e la frase della lettura, dal suo codice (§9.3). `open`: le proposte aperte dell'appunto adesso. */
export function readingOf(code: ReadingCode, open: number, parts?: { read: number; total: number }): { status: ReadingStatus; message: string } {
  switch (code) {
    case "letto":
      if (open === 0) return { status: "letto", message: CONTEXT_TEXT.add.nothingNew };
      return { status: "letto", message: open === 1 ? "Letti: 1 proposta da confermare." : `Letti: ${open} proposte da confermare.` };
    case "in_corso":
      return {
        status: "in_corso",
        message: `Letta la parte ${parts?.read ?? 1} di ${parts?.total ?? 2}. Per leggere il resto richiama add_context_notes ${SAME_CALL}.`,
      };
    case "in_lettura":
      return { status: "in_corso", message: `Li sta già leggendo un'altra richiesta. Riprova tra poco ${SAME_CALL}.` };
    case "ok_mancante":
      return { status: "ok_mancante", message: "Appunti salvati. La lettura parte quando c'è l'ok ai fornitori di AI: si registra in Unbundle, nella pagina Contesto." };
    case "rifiuto":
      return { status: "non_letto", message: CONTEXT_TEXT.read.refused };
    case "tempo":
      return { status: "da_riprovare", message: `La lettura ha preso troppo tempo. Gli appunti restano salvati: riprova ${SAME_CALL}.` };
    case "limite":
      return { status: "da_riprovare", message: CONTEXT_TEXT.read.limit };
    case "errore":
      return { status: "da_riprovare", message: `La lettura non è riuscita. Gli appunti restano salvati: riprova tra poco ${SAME_CALL}.` };
  }
}

/** Che cosa resta di una richiesta `add_context_notes`: l'appunto, se l'ha creato questa richiesta, e la lettura. */
interface SavedNote {
  sourceId: string;
  created: boolean;
  reading?: ReadingCode;
  partsRead?: number;
  partsTotal?: number;
  skipped?: SkippedCounts;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function skippedOf(value: unknown): SkippedCounts | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const out: SkippedCounts = {};
  for (const reason of ["persone", "sanitari", "altri_clienti", "clienti_del_cliente"] as const) {
    const n = count(raw[reason]);
    if (n !== undefined) out[reason] = n;
  }
  return out;
}

function savedNoteOf(result: Record<string, unknown> | null): SavedNote | null {
  if (!result || typeof result.sourceId !== "string" || !UUID.test(result.sourceId) || typeof result.created !== "boolean") return null;
  const reading = READING_CODES.includes(result.reading as ReadingCode) ? (result.reading as ReadingCode) : undefined;
  return {
    sourceId: result.sourceId,
    created: result.created,
    ...(reading ? { reading } : {}),
    ...(count(result.partsRead) !== undefined ? { partsRead: count(result.partsRead) } : {}),
    ...(count(result.partsTotal) !== undefined ? { partsTotal: count(result.partsTotal) } : {}),
    ...(skippedOf(result.skipped) ? { skipped: skippedOf(result.skipped) } : {}),
  };
}

async function addContextNotes(args: unknown, principal: TeamPrincipal, deps: TeamContextDeps, kit: ContextToolKit): Promise<TeamToolOutcome> {
  const input = validateTeamToolInput("add_context_notes", args);
  if (!input.ok) return failed(input.error);
  const data = input.data;
  const actor = deps.actor(principal);
  const occurredOn = data.date ?? romeToday(kit.now());
  const note: NewNoteInput = {
    title: data.title,
    occurredOn,
    body: data.text,
    participants: data.participants ?? null,
    link: data.link ?? null,
    origin: "claude",
    kind: "appunti",
  };

  // La risposta si costruisce dal risultato salvato (id e numeri) e rilegge i testi: vale anche per un duplicato.
  const respond = async (saved: SavedNote): Promise<TeamToolOutcome> => {
    const open = await deps.listOpen(actor, { sourceId: saved.sourceId });
    const source = open?.sources.find((entry) => entry.id.toLowerCase() === saved.sourceId.toLowerCase());
    const { shown, total } = proposalsOf(open);
    const parts = saved.partsRead !== undefined && saved.partsTotal !== undefined ? { read: saved.partsRead, total: saved.partsTotal } : undefined;
    return succeeded({
      source: {
        id: saved.sourceId,
        // Il titolo solo senza i dati di una persona; altrimenti «Appunti 14 nov».
        title: mcpSourceTitle(source ?? { title: data.title, kind: "appunti", origin: "claude", occurredOn }, kit.now()),
        date: source?.occurredOn ?? occurredOn,
        duplicate: !saved.created,
        link: linkToContextProposals(kit.appOrigin, principal.workspaceId, saved.sourceId),
      },
      reading: readingOf(saved.reading ?? "errore", total, parts),
      proposals: shown,
      notReported: notReportedLines(saved.skipped ?? source?.skipped),
      note: CONTEXT_PROPOSALS_NOTE,
    });
  };

  return kit.runWrite({
    tool: "add_context_notes",
    idempotencyKey: data.idempotencyKey,
    requestHash: teamRequestHash("add_context_notes", data),
    async duplicate(result) {
      const saved = savedNoteOf(result);
      return saved?.reading ? respond(saved) : failed(teamError("internal_error"));
    },
    async execute(claim, key): Promise<Execution> {
      // Una ripresa con la stessa chiave riparte dall'appunto già salvato da un tentativo di prima.
      const earlier = savedNoteOf(claim.result);
      let saved: SavedNote;
      if (earlier) {
        saved = { sourceId: earlier.sourceId, created: earlier.created };
      } else {
        const added = await deps.addNote(actor, note);
        if (!added.ok) return { ok: false, error: contextFailure(added, NOTE_FIELDS), partial: false };
        saved = { sourceId: added.value.sourceId, created: added.value.created };
        await kit.saveProgress(key, claim.attempt, { ...saved }).catch(() => false);
      }
      const read = await deps.read(actor, saved.sourceId, { timeoutMs: CONTEXT_MCP_READ_TIMEOUT_MS });
      // Una lettura che non riesce non toglie gli appunti: restano salvati, e la stessa chiamata riprende.
      const outcome: ReadOutcome = read.ok ? read.value : { status: "errore" };
      const result: SavedNote = {
        ...saved,
        reading: outcome.status,
        ...(outcome.status === "in_corso" ? { partsRead: outcome.partsRead, partsTotal: outcome.partsTotal } : {}),
        ...(outcome.status === "letto" ? { skipped: outcome.skipped } : {}),
      };
      return {
        ok: true,
        result: { ...result },
        resumable: RESUMABLE.has(outcome.status),
        respond: () => respond(result),
      };
    },
  });
}

// ═══ list_context_proposals ══════════════════════════════════════════

async function listContextProposals(args: unknown, principal: TeamPrincipal, deps: TeamContextDeps, kit: ContextToolKit): Promise<TeamToolOutcome> {
  const limited = await kit.consumeLimit("read");
  if (limited) return failed(limited);
  const input = validateTeamToolInput("list_context_proposals", args);
  if (!input.ok) return failed(input.error);
  const sourceId = input.data.sourceId;
  const open = await deps.listOpen(deps.actor(principal), sourceId ? { sourceId } : {});
  if (!open) return failed(teamError("permesso_mancante", { message: CONTEXT_LS_ONLY_MESSAGE }));
  const { shown, total } = proposalsOf(open);
  const more = shown.length < total ? ` Ne mostro ${shown.length} su ${total}: per le altre chiedi quelle di un appunto, con sourceId.` : "";
  return succeeded({
    proposals: shown,
    total,
    sources: open.sources.map((source) => ({
      id: source.id,
      // I titoli di Granola portano spesso nomi o e-mail: senza i dati di una persona, o «Call 14 nov».
      title: mcpSourceTitle(source, kit.now()),
      date: source.occurredOn,
      link: linkToContextProposals(kit.appOrigin, principal.workspaceId, source.id),
      notReported: notReportedLines(source.skipped),
    })),
    link: linkToContextProposals(kit.appOrigin, principal.workspaceId, sourceId),
    note: `${CONTEXT_PROPOSALS_NOTE}${more}`,
  });
}

// ═══ confirm_context_proposals ═══════════════════════════════════════

type ConfirmInputItem = NonNullable<ConfirmContextProposalsInput["confirm"]>[number];

export type ConfirmCheck = { ok: true; confirm: ConfirmItem[]; discard: string[] } | { ok: false; error: TeamMcpError };

/**
 * Le regole del sì della persona, sullo stato di adesso (`open`: le proposte aperte del workspace, per id in
 * minuscolo). Nell'ordine: una proposta due volte nella richiesta (`invalid_payload`); una proposta che non è più da
 * confermare o è cambiata (`version_conflict`); una «dedotto» senza `inferredConfirmed`, un conflitto senza
 * `resolution`, una proposta da correggere (`invalid_payload`). Tutte o nessuna: un errore non conferma niente.
 */
export function checkConfirmRequest(confirm: readonly ConfirmInputItem[], discard: readonly string[], open: ReadonlyMap<string, ProposalView>): ConfirmCheck {
  const twice: Record<string, string> = {};
  const seen = new Set<string>();
  const once = (id: string, field: string) => {
    const key = id.toLowerCase();
    if (seen.has(key)) twice[field] = CONTEXT_TWICE_MESSAGE;
    seen.add(key);
  };
  confirm.forEach((item, i) => once(item.id, `confirm.${i}.id`));
  discard.forEach((id, i) => once(id, `discard.${i}`));
  if (Object.keys(twice).length > 0) return { ok: false, error: teamError("invalid_payload", { fieldErrors: twice }) };

  const changed: Record<string, string> = {};
  confirm.forEach((item, i) => {
    const view = open.get(item.id.toLowerCase());
    if (!view) changed[`confirm.${i}.id`] = CONTEXT_GONE_MESSAGE;
    else if (view.version !== item.version) changed[`confirm.${i}.version`] = CONTEXT_CHANGED_MESSAGE;
  });
  discard.forEach((id, i) => {
    if (!open.has(id.toLowerCase())) changed[`discard.${i}`] = CONTEXT_GONE_MESSAGE;
  });
  if (Object.keys(changed).length > 0) return { ok: false, error: teamError("version_conflict", { message: CONTEXT_PROPOSALS_CHANGED_MESSAGE, fieldErrors: changed }) };

  const invalid: Record<string, string> = {};
  const items: ConfirmItem[] = confirm.map((item, i) => {
    const view = open.get(item.id.toLowerCase())!;
    if (view.issue) invalid[`confirm.${i}.id`] = CONTEXT_ISSUE_MESSAGE;
    else if (view.basis === "dedotto" && item.inferredConfirmed !== true) invalid[`confirm.${i}.inferredConfirmed`] = CONTEXT_INFERRED_MESSAGE;
    else if (view.kind === "conflitto" && item.resolution !== "prima" && item.resolution !== "ora") invalid[`confirm.${i}.resolution`] = CONTEXT_CONFLICT_MESSAGE;
    // La scelta vale solo per un conflitto: per le altre proposte non si passa.
    return view.kind === "conflitto" && item.resolution ? { id: view.id, version: view.version, resolution: item.resolution } : { id: view.id, version: view.version };
  });
  if (Object.keys(invalid).length > 0) return { ok: false, error: teamError("invalid_payload", { fieldErrors: invalid }) };
  return { ok: true, confirm: items, discard: discard.map((id) => open.get(id.toLowerCase())!.id) };
}

/** I numeri di una conferma: il risultato salvato, senza testi. */
interface ConfirmCounts {
  confirmed: number;
  discarded: number;
  newFacts: number;
  changedFacts: number;
  reconfirmed: number;
  commitments: number;
  questions: number;
  remaining: number;
}

const COUNT_KEYS = ["confirmed", "discarded", "newFacts", "changedFacts", "reconfirmed", "commitments", "questions", "remaining"] as const;
const CONFIRM_RESULT_KEYS = ["confirmed", "newFacts", "changedFacts", "reconfirmed", "commitments", "questions", "remaining"] as const;

function countsOf(value: unknown): ConfirmCounts | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const out = {} as ConfirmCounts;
  for (const key of COUNT_KEYS) {
    const n = count(raw[key]);
    if (n === undefined) return null;
    out[key] = n;
  }
  return out;
}

/** La conferma già fatta da un tentativo di prima con la stessa chiave (avanzamento salvato). */
function earlierConfirmOf(result: Record<string, unknown> | null): ConfirmResult | null {
  const raw = result?.confirmedStep;
  if (!raw || typeof raw !== "object") return null;
  const out = {} as ConfirmResult;
  for (const key of CONFIRM_RESULT_KEYS) {
    const n = count((raw as Record<string, unknown>)[key]);
    if (n === undefined) return null;
    out[key] = n;
  }
  return out;
}

/** Un `dati_non_validi` della conferma ha gli errori per id di proposta: diventano `confirm.N.id`. */
function confirmFailure(failure: { error: ServiceError; message?: string; fieldErrors?: Record<string, string> }, items: readonly ConfirmItem[]): TeamMcpError {
  const fields: Record<string, string> = {};
  items.forEach((item, i) => {
    fields[item.id] = `confirm.${i}.id`;
    fields[item.id.toLowerCase()] = `confirm.${i}.id`;
  });
  return contextFailure(failure, fields);
}

async function confirmContextProposals(args: unknown, principal: TeamPrincipal, deps: TeamContextDeps, kit: ContextToolKit): Promise<TeamToolOutcome> {
  const input = validateTeamToolInput("confirm_context_proposals", args);
  if (!input.ok) return failed(input.error);
  const data = input.data;
  const actor = deps.actor(principal);
  const workspaceId = principal.workspaceId;
  const confirm = data.confirm ?? [];
  const discard = data.discard ?? [];

  const respond = (counts: ConfirmCounts, duplicate: boolean): TeamToolOutcome =>
    succeeded({
      duplicate,
      ...counts,
      link: counts.remaining > 0 ? linkToContextProposals(kit.appOrigin, workspaceId) : linkToContext(kit.appOrigin, workspaceId),
    });

  return kit.runWrite({
    tool: "confirm_context_proposals",
    idempotencyKey: data.idempotencyKey,
    requestHash: teamRequestHash("confirm_context_proposals", data),
    async duplicate(result) {
      const counts = countsOf(result);
      return counts ? respond(counts, true) : failed(teamError("internal_error"));
    },
    async execute(claim, key): Promise<Execution> {
      // Una ripresa dopo una conferma riuscita (e uno scarto non riuscito) non rifà la conferma.
      const earlier = earlierConfirmOf(claim.result);
      const open = await deps.listOpen(actor);
      if (!open) return { ok: false, error: teamError("permesso_mancante", { message: CONTEXT_LS_ONLY_MESSAGE }), partial: earlier !== null };
      const byId = new Map<string, ProposalView>([...open.proposals, ...open.reconfirmed].map((view) => [view.id.toLowerCase(), view]));
      const check = checkConfirmRequest(earlier ? [] : confirm, discard, byId);
      if (!check.ok) return { ok: false, error: check.error, partial: earlier !== null };

      let confirmed = earlier;
      if (!confirmed && check.confirm.length > 0) {
        const result = await deps.confirm(actor, check.confirm);
        if (!result.ok) return { ok: false, error: confirmFailure(result, check.confirm), partial: false };
        confirmed = result.value;
        await kit.saveProgress(key, claim.attempt, { confirmedStep: { ...confirmed } }).catch(() => false);
      }

      let discarded = 0;
      if (check.discard.length > 0) {
        const result = await deps.discard(actor, check.discard);
        if (!result.ok) {
          const error = contextFailure(result);
          const partial = confirmed !== null;
          return { ok: false, error: partial ? { ...error, message: `${error.message} ${PARTIAL_CONFIRM_NOTE}` } : error, partial };
        }
        discarded = result.value.discarded;
      }

      const openBefore = byId.size;
      const counts: ConfirmCounts = {
        confirmed: confirmed?.confirmed ?? 0,
        discarded,
        newFacts: confirmed?.newFacts ?? 0,
        changedFacts: confirmed?.changedFacts ?? 0,
        reconfirmed: confirmed?.reconfirmed ?? 0,
        commitments: confirmed?.commitments ?? 0,
        questions: confirmed?.questions ?? 0,
        remaining: Math.max(0, (confirmed ? confirmed.remaining : openBefore) - discarded),
      };
      return {
        ok: true,
        result: { ...counts },
        respond: async () => {
          // `respond` gira una volta sola per chiave: «In breve» si riscrive dopo la risposta, solo se la memoria è cambiata.
          if (counts.confirmed > 0) deps.refreshBrief(workspaceId);
          return respond(counts, false);
        },
      };
    },
  });
}

// ═══ (9b) Le letture della memoria ═══════════════════════════════════

/** Una riga con gli id dei suoi use case (in minuscolo). */
export interface Linked<T> {
  view: T;
  useCaseIds: string[];
}

/** Quello che `get_context` e `list_context_commitments` leggono: la Memoria per chi guarda, con gli use case di ogni riga. */
export interface MemoryRead {
  lateralSpace: boolean;
  brief: string[];
  /** Nell'ordine di `loadContextMemory`: per sezione, e in ogni sezione dal più recente. Con il giorno in cui è nato. */
  facts: Array<Linked<FactView> & { createdOn: string }>;
  /** Aperti, per scadenza (senza scadenza in fondo); a pari scadenza prima i nostri. */
  commitments: Array<Linked<CommitmentView>>;
  questions: Array<Linked<QuestionView>>;
}

/** Il giorno di una scadenza per l'ordine: senza scadenza in fondo. */
const dueKey = (dueOn: string | null) => dueOn ?? "9999-12-31";

/**
 * La Memoria per chi guarda, con gli use case di ogni riga (§2.7). Quello che chi guarda non vede si toglie anche qui, se
 * mai una lettura lo restituisse (`visibleTo`): al cliente solo «Per tutti». Ogni riga si costruisce campo per campo
 * dopo (`mcpFact`, `mcpCommitment`, `mcpQuestion`), così niente di quello che la vista porta in più esce.
 */
export function joinMemory(memory: MemoryView, links: ContextLinks, viewer: Pick<ContextActor, "isLateralSpace">): MemoryRead {
  const visible = (view: { visibility: ContextVisibility }) => visibleTo(viewer, view.visibility);
  const facts = memory.sections
    .flatMap((section) => section.facts)
    .filter(visible)
    .map((view) => {
      const link = links.facts[view.id.toLowerCase()];
      // Una riga che la lettura degli use case non ha trovato (cambiata in mezzo): nessuno use case, e il giorno
      // dell'ultima conferma, che non viene mai prima di quello in cui il fatto è nato.
      return { view, useCaseIds: link?.useCaseIds ?? [], createdOn: link?.createdOn || view.lastConfirmedOn };
    });
  const commitments = [...memory.nextSteps.nostri, ...memory.nextSteps.cliente]
    .filter(visible)
    .map((view) => ({ view, useCaseIds: links.commitments[view.id.toLowerCase()] ?? [] }))
    .sort((a, b) => dueKey(a.view.dueOn).localeCompare(dueKey(b.view.dueOn)));
  const questions = memory.questions.filter(visible).map((view) => ({ view, useCaseIds: links.questions[view.id.toLowerCase()] ?? [] }));
  return { lateralSpace: viewer.isLateralSpace === true, brief: memory.brief?.lines ?? [], facts, commitments, questions };
}

/** I filtri di `get_context`: lo use case (id in minuscolo), la sezione, il giorno da cui contano i fatti nuovi o cambiati. */
export interface ContextFilter {
  useCaseId?: string | null;
  section?: ContextSection | null;
  since?: string | null;
}

/** Una riga tocca lo use case? Senza filtro, sì. */
const touches = (useCaseIds: readonly string[], useCaseId: string | null | undefined) => !useCaseId || useCaseIds.includes(useCaseId.toLowerCase());

/**
 * `get_context` (§5.7): i filtri e il tetto. Lo use case vale per fatti, impegni e domande; la sezione e `since` solo per
 * i fatti («In breve» resta sempre). I fatti oltre i 200 sono i meno recenti (ultima conferma): li conta `more`. Le
 * sezioni nell'ordine della Memoria, solo quelle con fatti.
 */
export function contextOutputOf(read: MemoryRead, filter: ContextFilter, refs: ContextLinks["useCases"], link: string) {
  const ctx = (useCaseIds: readonly string[]) => ({ lateralSpace: read.lateralSpace, useCases: linkedUseCaseCodes(useCaseIds, refs) });
  const matching = read.facts.filter(
    (fact) => touches(fact.useCaseIds, filter.useCaseId) && (!filter.section || fact.view.section === filter.section) && (!filter.since || fact.createdOn >= filter.since),
  );
  // I più recenti prima (a pari giorno vale l'ordine della Memoria), poi di nuovo per sezione.
  const shown = new Set([...matching].sort((a, b) => b.view.lastConfirmedOn.localeCompare(a.view.lastConfirmedOn)).slice(0, CONTEXT_MCP_FACTS_MAX));
  const kept = matching.filter((fact) => shown.has(fact));
  const commitments = read.commitments.filter((c) => touches(c.useCaseIds, filter.useCaseId));
  const questions = read.questions.filter((q) => touches(q.useCaseIds, filter.useCaseId));
  return {
    brief: [...read.brief],
    sections: CONTEXT_SECTIONS.flatMap((section) => {
      const facts = kept.filter((fact) => fact.view.section === section);
      return facts.length > 0 ? [{ section, sectionLabel: CONTEXT_TEXT.sections[section], facts: facts.map((fact) => mcpFact(fact.view, ctx(fact.useCaseIds))) }] : [];
    }),
    more: matching.length - kept.length,
    commitments: commitments.map((c) => mcpCommitment(c.view, ctx(c.useCaseIds))),
    questions: questions.map((q) => mcpQuestion(q.view, ctx(q.useCaseIds))),
    counts: { facts: matching.length, commitments: commitments.length, questions: questions.length },
    link,
    note: CONTEXT_MEMORY_NOTE,
  };
}

/** I filtri di `list_context_commitments`: la parte, lo use case (id in minuscolo), solo gli scaduti. Mai la persona. */
export interface CommitmentFilter {
  party?: "nostra" | "cliente" | null;
  useCaseId?: string | null;
  overdueOnly?: boolean;
}

/** `list_context_commitments` (§5.7): gli impegni aperti dopo i filtri, per scadenza, con il totale. */
export function commitmentsOutputOf(read: MemoryRead, filter: CommitmentFilter, refs: ContextLinks["useCases"], link: string) {
  const commitments = read.commitments.filter(
    (c) => (!filter.party || c.view.party === filter.party) && touches(c.useCaseIds, filter.useCaseId) && (filter.overdueOnly !== true || c.view.overdue === true),
  );
  return {
    commitments: commitments.map((c) => mcpCommitment(c.view, { lateralSpace: read.lateralSpace, useCases: linkedUseCaseCodes(c.useCaseIds, refs) })),
    total: commitments.length,
    link,
  };
}

type Loaded = { ok: true; read: MemoryRead; refs: ContextLinks["useCases"]; useCaseId: string | null } | { ok: false; error: TeamMcpError };

/**
 * La Memoria per chi ha il token, senza contare una visita, con gli use case delle righe che servono. Uno use case che non
 * c'è in questo workspace: `not_found`. Chi non apre «Contesto»: `permesso_mancante`. La lettura degli use case che non
 * riesce: `riprova`.
 */
async function loadMemory(principal: TeamPrincipal, deps: TeamContextDeps, kit: ContextToolKit, opts: { useCase?: string; facts: boolean }): Promise<Loaded> {
  const actor = deps.actor(principal);
  if (!contextAbilities(actor).canOpen) return { ok: false, error: teamError("permesso_mancante") };
  let useCaseId: string | null = null;
  if (opts.useCase !== undefined) {
    useCaseId = (await kit.findUseCaseId(opts.useCase.toUpperCase()))?.toLowerCase() ?? null;
    if (!useCaseId) return { ok: false, error: teamError("not_found") };
  }
  const memory = await deps.memory(actor, { touchSeen: false });
  const ids = (list: ReadonlyArray<{ id: string }>) => list.map((row) => row.id);
  const links = await deps.links(actor, {
    factIds: opts.facts ? ids(memory.sections.flatMap((section) => section.facts)) : [],
    commitmentIds: ids([...memory.nextSteps.nostri, ...memory.nextSteps.cliente]),
    questionIds: opts.facts ? ids(memory.questions) : [],
  });
  if (!links) return { ok: false, error: teamError("riprova", { message: CONTEXT_TEXT.errors.retry }) };
  const read = joinMemory(opts.facts ? memory : { ...memory, sections: [], questions: [] }, links, actor);
  return { ok: true, read, refs: links.useCases, useCaseId };
}

// ═══ get_context ═════════════════════════════════════════════════════

async function getContext(args: unknown, principal: TeamPrincipal, deps: TeamContextDeps, kit: ContextToolKit): Promise<TeamToolOutcome> {
  const limited = await kit.consumeLimit("read");
  if (limited) return failed(limited);
  const input = validateTeamToolInput("get_context", args);
  if (!input.ok) return failed(input.error);
  const { useCase, section, since } = input.data;
  // Lo schema vuole AAAA-MM-GG; il giorno deve anche esistere (non il 2026-02-30).
  if (since !== undefined && !isIsoDate(since)) return failed(teamError("invalid_payload", { fieldErrors: { since: CONTEXT_TEXT.errors.dateInvalid } }));
  const loaded = await loadMemory(principal, deps, kit, { useCase, facts: true });
  if (!loaded.ok) return failed(loaded.error);
  return succeeded(contextOutputOf(loaded.read, { useCaseId: loaded.useCaseId, section, since }, loaded.refs, linkToContext(kit.appOrigin, principal.workspaceId)));
}

// ═══ list_context_commitments ════════════════════════════════════════

async function listContextCommitments(args: unknown, principal: TeamPrincipal, deps: TeamContextDeps, kit: ContextToolKit): Promise<TeamToolOutcome> {
  const limited = await kit.consumeLimit("read");
  if (limited) return failed(limited);
  const input = validateTeamToolInput("list_context_commitments", args);
  if (!input.ok) return failed(input.error);
  const { party, useCase, overdueOnly } = input.data;
  const loaded = await loadMemory(principal, deps, kit, { useCase, facts: false });
  if (!loaded.ok) return failed(loaded.error);
  return succeeded(commitmentsOutputOf(loaded.read, { party, useCaseId: loaded.useCaseId, overdueOnly }, loaded.refs, linkToContext(kit.appOrigin, principal.workspaceId)));
}

// ═══ ask_context ═════════════════════════════════════════════════════

/** Un esito non riuscito di `askContext`: la domanda non valida su `question`, il resto come le altre funzioni. */
function askFailure(failure: { error: ServiceError; message?: string; fieldErrors?: Record<string, string> }): TeamMcpError {
  if (failure.error === "riprova") return teamError("riprova", { message: CONTEXT_TEXT.ask.failed });
  if (failure.error === "permesso_mancante") return teamError("permesso_mancante");
  return contextFailure(failure, { question: "question" });
}

/**
 * La risposta di `ask_context` (§5.7) dall'esito di `askContext`: lo stato, la risposta scritta solo con lo stato
 * «risposta», i brani (`mcpAskSource`) e la nota. Una risposta con i dati di una persona non si manda: vale «non lo
 * sappiamo», con i brani che la persona può aprire in Unbundle (`askContext` fa così con i dati sanitari).
 */
export function askOutputOf(answer: Exclude<AskAnswer, { status: "limite" }>, today: Date | string) {
  const sources = answer.status === "niente" ? [] : answer.sources.map((source) => mcpAskSource(source, today));
  if (answer.status === "risposta" && scanPersonalData(answer.answer).ok) return { status: answer.status, answer: answer.answer, sources, note: CONTEXT_MEMORY_NOTE };
  return { status: answer.status === "risposta" ? ("non_so" as const) : answer.status, answer: null, sources, note: CONTEXT_MEMORY_NOTE };
}

async function askContextTool(args: unknown, principal: TeamPrincipal, deps: TeamContextDeps, kit: ContextToolKit): Promise<TeamToolOutcome> {
  const limited = await kit.consumeLimit("read");
  if (limited) return failed(limited);
  const input = validateTeamToolInput("ask_context", args);
  if (!input.ok) return failed(input.error);
  const actor = deps.actor(principal);
  if (!contextAbilities(actor).canAsk) return failed(teamError("permesso_mancante"));
  // `askContext` controlla i suoi limiti, cerca solo tra quello che chi chiede può vedere e chiama il modello solo con l'ok.
  const asked = await deps.ask(actor, input.data.question);
  if (!asked.ok) return failed(askFailure(asked));
  const answer = asked.value;
  if (answer.status === "limite") return failed(teamError("rate_limited", { message: CONTEXT_TEXT.ask.limit, retryAfterSeconds: answer.retryAfterSeconds }));
  return succeeded(askOutputOf(answer, kit.now()));
}
