import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { CONTEXT_TEXT } from "../../context/text.ts";
import { contextActorFromPrincipal, type ContextActor } from "../../context/visibility.ts";
import type { CommitmentParty, ContextSection, ContextVisibility, ProposalKind, SkippedCounts, SourceKind, SourceOrigin } from "../../context/vocab.ts";
import type { AskAnswer, AskSource } from "../../db/queries/context-ask.ts";
import type { CommitmentView, FactView, MemoryView, QuestionView } from "../../db/queries/context-memory.ts";
import type { ConfirmItem, OpenProposals, ProposalView } from "../../db/queries/context-proposals.ts";
import type { ReadOutcome } from "../../db/queries/context-read.ts";
import type { NewNoteInput } from "../../db/queries/context-sources.ts";
import type { ContextLinks } from "../../db/queries/context-team.ts";
import type { TeamClaim, TeamRequestKey, TeamRequestRow } from "../../db/queries/team-mcp-requests.ts";
import { abilitiesForUseCase, type UseCaseViewer } from "../permissions.ts";
import type { ServiceResult } from "../types.ts";
import { TEAM_MCP_READ_SCOPE, TEAM_MCP_SCOPES, teamPrincipalKey, type TeamPrincipal } from "./auth.ts";
import {
  CONTEXT_CONFLICT_MESSAGE,
  CONTEXT_GONE_MESSAGE,
  CONTEXT_INFERRED_MESSAGE,
  CONTEXT_ISSUE_MESSAGE,
  CONTEXT_LS_ONLY_MESSAGE,
  CONTEXT_MCP_FACTS_MAX,
  CONTEXT_MCP_READ_TIMEOUT_MS,
  CONTEXT_MEMORY_TOOL_NAMES,
  CONTEXT_PROPOSALS_CHANGED_MESSAGE,
  CONTEXT_TWICE_MESSAGE,
  type TeamContextDeps,
} from "./context-tools.ts";
import { READ_ONLY_TOKEN_MESSAGE, TEAM_MCP_ERROR_MESSAGES, type TeamToolName } from "./contract.ts";
import { decideExistingTeamRequest } from "./idempotency.ts";
import { CONTEXT_EXCERPT_HIDDEN, CONTEXT_MEMORY_NOTE, CONTEXT_PROPOSALS_NOTE } from "./output.ts";
import { callTeamTool, type TeamToolDeps } from "./tools.ts";

// I tre strumenti di «Contesto» dell'MCP del team con dipendenze finte (RILASCIO-9a-COSTRUZIONE.md §9, §11.4): chi
// può, il sì della persona (dedotte, conflitti, proposte da correggere), l'idempotenza (una scrittura sola per chiave,
// la ripresa di una lettura a metà), nessun «Con chi» nelle uscite, appunti salvati e non letti senza l'ok. Le stesse
// regole con il database e il Claude finto sono in `mcp.integration.test.ts`.
//
// (9b, RILASCIO-9b-COSTRUZIONE.md §2.7, §5.7) Le tre letture della memoria: `get_context`, `ask_context`,
// `list_context_commitments`. Un token del cliente non riceve fatti «Solo Lateral Space» né `visibilityLabel`; nessuna
// uscita porta citazioni, «Con chi» o chi ha confermato; un brano di appunti con un nome esce senza testo; `get_context`
// non conta come una visita («Novità per te»).

const WS = randomUUID();
const KEY = "contesto-prova-0001";
/** «Con chi»: nomi che non devono mai uscire dall'MCP. */
const PEOPLE = "Mario Rossi e Giulia Bianchi";
const NOTE_TEXT = "Call di avvio. Il gestionale è SAP Business One. Gli ordini si inseriscono a mano ogni mattina.";

function principal(opts: { isLateralSpace?: boolean; scopes?: string[]; role?: string } = {}): TeamPrincipal {
  const tokenId = randomUUID();
  const viewer: UseCaseViewer = {
    userId: randomUUID(),
    email: opts.isLateralSpace === false ? "persona@cliente.test" : "persona@ls.test",
    emailVerified: true,
    role: opts.role ?? "transformation_lead",
    isLateralSpace: opts.isLateralSpace ?? true,
  };
  const scopes = opts.scopes ?? [...TEAM_MCP_SCOPES];
  return {
    tokenId,
    workspaceId: WS,
    userId: viewer.userId!,
    principalKey: teamPrincipalKey(tokenId),
    scopes,
    canWrite: scopes.includes("use_cases:write"),
    viewer,
    abilities: abilitiesForUseCase(viewer),
    workspaceName: "Cliente di prova",
  };
}

/** Un archivio delle richieste in memoria, con le regole delle query di team-mcp-requests.ts. */
function memoryRequests() {
  const rows = new Map<string, TeamRequestRow>();
  const id = (key: TeamRequestKey) => `${key.workspaceId}|${key.principalKey}|${key.idempotencyKey}`;
  const owned = (key: TeamRequestKey, attempt: number) => {
    const row = rows.get(id(key));
    return row && row.status === "pending" && row.attempt === attempt ? row : null;
  };
  return {
    rows,
    store: {
      async read(key: TeamRequestKey) {
        const row = rows.get(id(key));
        return row ? { ...row } : null;
      },
      async claim(params: TeamRequestKey & { tool: string; requestHash: string; reservedIds: string[] | null }): Promise<TeamClaim> {
        const row = rows.get(id(params));
        if (!row) {
          rows.set(id(params), { status: "pending", requestHash: params.requestHash, tool: params.tool, result: null, reservedIds: params.reservedIds, attempt: 1, ageSeconds: 0 });
          return { status: "claimed", attempt: 1, reservedIds: params.reservedIds, result: null, takeover: false, createdAt: new Date() };
        }
        const decision = decideExistingTeamRequest(row, params.requestHash);
        if (decision.kind === "duplicate") return { status: "duplicate", result: row.result };
        if (decision.kind === "conflict") return { status: "conflict" };
        if (decision.kind === "in_progress") return { status: "in_progress", retryAfterSeconds: decision.retryAfterSeconds };
        row.status = "pending";
        row.attempt += 1;
        return { status: "claimed", attempt: row.attempt, reservedIds: row.reservedIds, result: row.result, takeover: true, createdAt: new Date() };
      },
      async progress(key: TeamRequestKey, attempt: number, result: Record<string, unknown>) {
        const row = owned(key, attempt);
        if (row) row.result = result;
        return Boolean(row);
      },
      async complete(key: TeamRequestKey, attempt: number, result: Record<string, unknown>) {
        const row = owned(key, attempt);
        if (row) Object.assign(row, { status: "completed", result });
        return Boolean(row);
      },
      async fail(key: TeamRequestKey, attempt: number) {
        const row = owned(key, attempt);
        if (row) row.status = "failed";
        return Boolean(row);
      },
      async release(key: TeamRequestKey, attempt: number) {
        const row = owned(key, attempt);
        if (row) rows.delete(id(key));
        return Boolean(row);
      },
    },
  };
}

/** Il limite delle richieste: sempre sotto il tetto, contando le chiamate e i secchi usati. */
function memoryLimits() {
  let queries = 0;
  const buckets: string[] = [];
  const exec = async (text: string, params: unknown[]) => {
    queries += 1;
    if (!String(text).includes("WITH clock")) return [];
    const rules = JSON.parse(String(params[0])) as Array<{ bucket: string; lim: number; cost: number }>;
    buckets.push(...rules.map((r) => r.bucket));
    return rules.map((r) => ({ bucket: r.bucket, lim: r.lim, used: 0, cost: r.cost, after_count: r.cost, allowed: true, retry_after: 0 }));
  };
  return { exec, queries: () => queries, buckets };
}

type Stored = ProposalView & { status: "aperta" | "confermata" | "scartata" };

function proposal(sourceId: string, over: Partial<ProposalView> = {}): Stored {
  return {
    id: randomUUID(),
    version: 1,
    sourceId,
    kind: "nuovo",
    statement: "Il gestionale è SAP Business One.",
    quote: "Il gestionale è SAP Business One.",
    basis: "detto",
    section: "sistemi",
    visibility: "tutti",
    preselected: true,
    issue: null,
    issueMessage: null,
    before: null,
    useCases: [],
    party: null,
    roleLabel: null,
    dueOn: null,
    closesQuestion: null,
    status: "aperta",
    ...over,
  };
}

// ─── (9b) La memoria del cliente, in memoria ─────────────────────────

const UC_A = randomUUID();
const UC_B = randomUUID();
/** I codici degli use case del workspace di prova, per `findUseCaseId`. */
const CODES: Readonly<Record<string, string>> = { "XX-0012": UC_A, "XX-0013": UC_B };

/** Campi che una vista potrebbe portare in più: non escono mai dall'MCP (art. 15.4, §2.7). */
const EXTRA = { quote: `Lo ha detto ${PEOPLE}.`, participants: PEOPLE, confirmedBy: { name: "Mario Rossi", on: "2026-11-14" }, addedBy: "mario.rossi@cliente.test" };

type FactSeed = FactView & { useCaseIds: string[]; createdOn: string };

function fact(over: Partial<FactSeed> & { statement: string }): FactSeed {
  return {
    id: randomUUID(),
    version: 1,
    kind: "fatto",
    section: "sistemi",
    basis: "detto",
    visibility: "tutti",
    needsCheck: false,
    sourceKind: "call",
    sourceLabel: "Call 14 nov",
    lastConfirmedOn: "2026-11-14",
    useCaseIds: [],
    createdOn: "2026-11-14",
    ...EXTRA,
    ...over,
  } as FactSeed;
}

type CommitmentSeed = CommitmentView & { useCaseIds: string[] };

function commitment(over: Partial<CommitmentSeed> & { statement: string; party: CommitmentParty }): CommitmentSeed {
  return { id: randomUUID(), version: 1, roleLabel: null, dueOn: null, overdue: false, visibility: "tutti", useCaseIds: [], ...EXTRA, ...over } as CommitmentSeed;
}

type QuestionSeed = QuestionView & { useCaseIds: string[] };

function question(over: Partial<QuestionSeed> & { question: string }): QuestionSeed {
  return { id: randomUUID(), version: 1, askWhom: null, visibility: "tutti", useCaseIds: [], ...EXTRA, ...over } as QuestionSeed;
}

/** La memoria di prova: due use case, un fatto e un impegno «Solo Lateral Space», un fatto da verificare e dedotto. */
function seedMemory() {
  return {
    brief: ["Distributore di ricambi con circa 120 persone.", "Gli ordini si inseriscono a mano."],
    facts: [
      fact({ statement: "Il gestionale è SAP Business One.", section: "sistemi", useCaseIds: [UC_A], lastConfirmedOn: "2026-11-14", createdOn: "2026-11-14" }),
      fact({ statement: "Il budget del progetto non è ancora approvato.", section: "regole", visibility: "ls", sourceKind: "manuale", sourceLabel: "Scritto a mano", lastConfirmedOn: "2026-11-10", createdOn: "2026-10-01" }),
      fact({
        statement: "Gli ordini arrivano soprattutto per telefono.",
        section: "lavoro",
        basis: "dedotto",
        needsCheck: true,
        useCaseIds: [UC_A, UC_B],
        lastConfirmedOn: "2026-05-02",
        createdOn: "2026-05-02",
      }),
    ],
    commitments: [
      commitment({ statement: "Mandare il preventivo.", party: "nostra", roleLabel: "Responsabile del progetto", dueOn: "2026-11-10", overdue: true, useCaseIds: [UC_A] }),
      commitment({ statement: "Inviare l'esportazione delle fatture.", party: "cliente", roleLabel: "Ufficio amministrazione", dueOn: "2026-11-25", visibility: "ls" }),
      commitment({ statement: "Confermare chi approva gli acquisti.", party: "cliente", roleLabel: "Direzione acquisti", useCaseIds: [UC_B] }),
    ],
    questions: [
      question({ question: "Chi approva gli acquisti sopra soglia?", askWhom: "Direzione acquisti", useCaseIds: [UC_B] }),
      question({ question: "Il budget è già confermato?", visibility: "ls" }),
    ],
  };
}

type Seeded = ReturnType<typeof seedMemory>;
const visibleFor = (actor: ContextActor, visibility: ContextVisibility) => visibility === "tutti" || actor.isLateralSpace;
/** La riga come la restituisce la funzione condivisa: senza gli use case e il giorno di prova (gli altri campi in più restano). */
function asView<T extends object>(row: T): T {
  const copy = { ...row } as Record<string, unknown>;
  delete copy.useCaseIds;
  delete copy.createdOn;
  return copy as T;
}

/** `loadContextMemory` e `loadContextLinks` finti, con le regole di visibilità delle funzioni vere. `leak`: una lettura sbagliata. */
function memoryReads(seed: Seeded, opts: { leak?: boolean }) {
  const sees = (actor: ContextActor, visibility: ContextVisibility) => opts.leak === true || visibleFor(actor, visibility);
  const memory = (actor: ContextActor): MemoryView => {
    const facts = seed.facts.filter((f) => sees(actor, f.visibility)).map((f) => asView(f) as FactView);
    const commitments = seed.commitments.filter((c) => sees(actor, c.visibility)).map((c) => asView(c) as CommitmentView);
    return {
      sections: (["azienda", "persone", "lavoro", "sistemi", "obiettivi", "regole", "parole"] as ContextSection[]).map((section) => ({
        section,
        live: [],
        facts: facts.filter((f) => f.section === section),
      })),
      nextSteps: { nostri: commitments.filter((c) => c.party === "nostra"), cliente: commitments.filter((c) => c.party === "cliente") },
      questions: seed.questions.filter((q) => sees(actor, q.visibility)).map((q) => asView(q) as QuestionView),
      brief: { lines: [...seed.brief], updatedOn: "2026-11-15" },
      novelties: { items: [{ factId: seed.facts[0].id, statement: seed.facts[0].statement, section: "sistemi", tag: "nuovo" }], more: 0 },
      counts: { facts: facts.length, openProposals: 4, unreadSources: 1, pendingSourceIds: [randomUUID()], toCheck: 1 },
    };
  };
  const links = (actor: ContextActor, ids: { factIds: readonly string[]; commitmentIds: readonly string[]; questionIds: readonly string[] }): ContextLinks => {
    const pick = <T extends { id: string; visibility: ContextVisibility }>(rows: readonly T[], wanted: readonly string[]) => rows.filter((row) => wanted.includes(row.id) && visibleFor(actor, row.visibility));
    return {
      useCases: { [UC_A.toLowerCase()]: { code: "XX-0012", title: "Ordini al telefono" }, [UC_B.toLowerCase()]: { code: "XX-0013", title: "Acquisti sopra soglia" } },
      facts: Object.fromEntries(pick(seed.facts, ids.factIds).map((f) => [f.id.toLowerCase(), { useCaseIds: f.useCaseIds.map((id) => id.toLowerCase()), createdOn: f.createdOn }])),
      commitments: Object.fromEntries(pick(seed.commitments, ids.commitmentIds).map((c) => [c.id.toLowerCase(), c.useCaseIds.map((id) => id.toLowerCase())])),
      questions: Object.fromEntries(pick(seed.questions, ids.questionIds).map((q) => [q.id.toLowerCase(), q.useCaseIds.map((id) => id.toLowerCase())])),
    };
  };
  return { memory, links };
}

/**
 * «Contesto» in memoria, con le regole delle funzioni condivise che contano qui: solo Lateral Space, lo stesso testo
 * una volta sola, «visita medica» fermato, conferma tutte o nessuna. La lettura risponde dalla coda `reads`; una
 * lettura «letto» mette le proposte di `drafts` sull'appunto. (9b) La memoria di `seedMemory`, gli use case delle
 * righe e «Chiedi al contesto» dalla coda `asks`.
 */
function memoryContext(opts: { ready?: boolean; leak?: boolean; linksFail?: boolean } = {}) {
  const sources = new Map<string, { id: string; kind: SourceKind; origin: SourceOrigin; title: string; occurredOn: string; body: string; participants: string | null; skipped: SkippedCounts }>();
  const proposals = new Map<string, Stored>();
  const calls: Record<string, unknown[][]> = {};
  const reads: Array<ReadOutcome | "fallisce"> = [];
  const drafts: Array<Partial<ProposalView>> = [];
  const briefs: string[] = [];
  const failNext: Partial<Record<"confirm" | "discard", ServiceResult<never>>> = {};
  const seed = seedMemory();
  const reads9b = memoryReads(seed, { leak: opts.leak });
  const asks: Array<ServiceResult<AskAnswer>> = [];
  const note = (name: string, ...args: unknown[]) => (calls[name] ??= []).push(args);
  const denied = { ok: false as const, error: "permesso_mancante" as const, message: "Non hai i permessi per farlo." };
  const view = ({ status: _status, ...rest }: Stored): ProposalView => {
    void _status;
    return { ...rest };
  };
  const deps: TeamContextDeps = {
    ready: async () => opts.ready ?? true,
    actor: contextActorFromPrincipal,
    async addNote(actor, input: NewNoteInput) {
      note("addNote", actor, input);
      if (!actor.isLateralSpace) return denied;
      if (input.body.includes("visita medica")) return { ok: false, error: "dati_non_validi", message: "x", fieldErrors: { body: CONTEXT_TEXT.add.blockedHealth("visita medica") } };
      const same = [...sources.values()].find((s) => s.body === input.body);
      if (same) return { ok: true, value: { sourceId: same.id, created: false, readStatus: "letto" } };
      const id = randomUUID();
      sources.set(id, { id, kind: input.kind ?? "appunti", origin: input.origin, title: input.title, occurredOn: input.occurredOn, body: input.body, participants: input.participants ?? null, skipped: {} });
      return { ok: true, value: { sourceId: id, created: true, readStatus: "da_leggere" } };
    },
    async read(actor, sourceId, o) {
      note("read", actor, sourceId, o);
      const next = reads.shift() ?? { status: "letto", proposals: 0, skipped: {} };
      if (next === "fallisce") return { ok: false, error: "riprova", message: "x" };
      if (next.status === "letto" || next.status === "in_corso") {
        for (const draft of drafts.splice(0)) {
          const p = proposal(sourceId, draft);
          proposals.set(p.id, p);
        }
      }
      if (next.status === "letto") sources.get(sourceId)!.skipped = next.skipped;
      return { ok: true, value: next };
    },
    async listOpen(actor, o = {}) {
      note("listOpen", actor, o);
      if (!actor.isLateralSpace) return null;
      const open = [...proposals.values()].filter((p) => p.status === "aperta" && (!o.sourceId || p.sourceId === o.sourceId));
      const used = [...new Set(open.map((p) => p.sourceId))].map((id) => sources.get(id)!);
      const result: OpenProposals = {
        sources: used.map((s) => ({ id: s.id, kind: s.kind, origin: s.origin, title: s.title, occurredOn: s.occurredOn, skipped: s.skipped })),
        proposals: open.filter((p) => p.kind !== "conferma").map(view),
        reconfirmed: open.filter((p) => p.kind === "conferma").map(view),
      };
      return result;
    },
    async confirm(actor, items: readonly ConfirmItem[]) {
      note("confirm", actor, items);
      if (failNext.confirm) {
        const failure = failNext.confirm;
        delete failNext.confirm;
        return failure;
      }
      for (const item of items) {
        const p = proposals.get(item.id);
        if (!p || p.status !== "aperta" || p.version !== item.version) return { ok: false, error: "versione_superata", message: "x" };
      }
      let newFacts = 0;
      let commitments = 0;
      for (const item of items) {
        const p = proposals.get(item.id)!;
        p.status = "confermata";
        if (p.kind === "impegno") commitments += 1;
        else newFacts += 1;
      }
      const remaining = [...proposals.values()].filter((p) => p.status === "aperta").length;
      return { ok: true, value: { confirmed: items.length, newFacts, changedFacts: 0, reconfirmed: 0, commitments, questions: 0, remaining } };
    },
    async discard(actor, ids) {
      note("discard", actor, ids);
      if (failNext.discard) {
        const failure = failNext.discard;
        delete failNext.discard;
        return failure;
      }
      let discarded = 0;
      for (const id of ids) {
        const p = proposals.get(id);
        if (p?.status === "aperta") {
          p.status = "scartata";
          discarded += 1;
        }
      }
      return { ok: true, value: { discarded } };
    },
    refreshBrief(workspaceId) {
      briefs.push(workspaceId);
    },
    async memory(actor, o) {
      note("memory", actor, o);
      return reads9b.memory(actor);
    },
    async links(actor, ids) {
      note("links", actor, ids);
      return opts.linksFail ? null : reads9b.links(actor, ids);
    },
    async ask(actor, text) {
      note("ask", actor, text);
      return asks.shift() ?? { ok: true, value: { status: "niente" } };
    },
  };
  return { deps, sources, proposals, calls, reads, drafts, briefs, failNext, seed, asks };
}

function harness(opts: { ready?: boolean; leak?: boolean; linksFail?: boolean } = {}) {
  const requests = memoryRequests();
  const limits = memoryLimits();
  const context = memoryContext(opts);
  const deps = {
    isAreaOn: () => true,
    rateLimitExec: limits.exec,
    random: () => 0.5,
    appOrigin: "https://www.theunbundle.com",
    log: { error() {} },
    // Solo il codice di uno use case serve a «Contesto» (9b): il resto delle letture ha i suoi test (tools.test.ts).
    reads: {
      async findUseCaseId(workspaceId: string, code: string) {
        return workspaceId === WS && Object.hasOwn(CODES, code) ? CODES[code] : null;
      },
    } as unknown as TeamToolDeps["reads"],
    service: {} as TeamToolDeps["service"],
    requests: requests.store,
    context: context.deps,
    notifyCreated() {},
    now: () => new Date("2026-11-16T09:00:00Z"),
  } satisfies TeamToolDeps;
  return { deps, requests, limits, context };
}

type Out = { isError: boolean; content: Record<string, unknown>; outcome: string };

async function call(h: ReturnType<typeof harness>, name: TeamToolName, args: unknown, who: TeamPrincipal): Promise<Out> {
  const out = await callTeamTool(name, args, who, h.deps);
  return { isError: out.result.isError === true, content: out.result.structuredContent as Record<string, unknown>, outcome: out.outcome };
}

const addArgs = (over: Record<string, unknown> = {}) => ({
  title: "Call di avvio",
  date: "2026-11-14",
  text: NOTE_TEXT,
  participants: PEOPLE,
  link: "https://notes.example.test/call-di-avvio",
  idempotencyKey: KEY,
  confirmedByUser: true,
  ...over,
});

type McpOut = { id: string; version: number; kind: ProposalKind; basis: string };

// ─── Chi può ─────────────────────────────────────────────────────────

test("un token di una persona del cliente: permesso_mancante sui tre strumenti, senza toccare il contesto né la chiave", async () => {
  const h = harness();
  const client = principal({ isLateralSpace: false, role: "function_lead" });
  for (const [name, args] of [
    ["add_context_notes", addArgs()],
    ["list_context_proposals", {}],
    ["confirm_context_proposals", { discard: [randomUUID()], idempotencyKey: KEY, confirmedByUser: true }],
  ] as const) {
    const out = await call(h, name, args, client);
    assert.deepEqual(out.content, { error: "permesso_mancante", message: CONTEXT_LS_ONLY_MESSAGE }, name);
  }
  assert.deepEqual(h.context.calls, {});
  assert.equal(h.requests.rows.size, 0);
  assert.equal(h.limits.queries(), 0, "nessun limite consumato per una richiesta respinta");
});

test("token «Solo lettura» di Lateral Space: le due scritture permesso_mancante, la lettura delle proposte passa", async () => {
  const h = harness();
  const reader = principal({ scopes: [TEAM_MCP_READ_SCOPE] });
  for (const name of ["add_context_notes", "confirm_context_proposals"] as const) {
    const out = await call(h, name, addArgs(), reader);
    assert.deepEqual(out.content, { error: "permesso_mancante", message: READ_ONLY_TOKEN_MESSAGE }, name);
  }
  const list = await call(h, "list_context_proposals", {}, reader);
  assert.equal(list.isError, false);
  assert.deepEqual(list.content.proposals, []);
  assert.equal(h.context.calls.addNote, undefined);
});

test("senza la 0038: riprova con «il contesto si sta preparando», senza leggere la chiave", async () => {
  const h = harness({ ready: false });
  for (const name of ["add_context_notes", "list_context_proposals", "confirm_context_proposals"] as const) {
    const out = await call(h, name, addArgs(), principal());
    assert.deepEqual(out.content, { error: "riprova", message: CONTEXT_TEXT.errors.notReady }, name);
  }
  assert.equal(h.requests.rows.size, 0);
});

test("la persona del token in «Contesto»: ruolo e Lateral Space riletti, canale «claude»; il MCP non carica la sessione", () => {
  const ls = principal();
  assert.deepEqual(contextActorFromPrincipal(ls), { workspaceId: WS, userId: ls.userId, role: "transformation_lead", isLateralSpace: true, channel: "claude" });
  const client = principal({ isLateralSpace: false, role: "analyst" });
  assert.deepEqual(contextActorFromPrincipal(client), { workspaceId: WS, userId: client.userId, role: "analyst", isLateralSpace: false, channel: "claude" });
  // src/lib/context/server/actor.ts carica `auth()` (Firebase) per le pagine: le dipendenze del MCP non lo importano, e
  // usano la stessa funzione che quel modulo riesporta (una sola regola per il token).
  const deps = readFileSync(new URL("./app-deps.ts", import.meta.url), "utf8");
  assert.match(deps, /actor: contextActorFromPrincipal,/);
  assert.match(deps, /import \{ contextActorFromPrincipal \} from "@\/lib\/context\/visibility";/);
  assert.doesNotMatch(deps, /@\/lib\/context\/server\/actor|@\/lib\/auth"/);
  const actorModule = readFileSync(new URL("../../context/server/actor.ts", import.meta.url), "utf8");
  assert.match(actorModule, /export \{ contextActorFromPrincipal \} from "@\/lib\/context\/visibility";/);
  assert.doesNotMatch(actorModule, /export function contextActorFromPrincipal/);
});

// ─── add_context_notes ───────────────────────────────────────────────

test("add_context_notes: salva (origine «claude»), legge in 75 secondi e restituisce le proposte con le etichette, senza «Con chi»", async () => {
  const h = harness();
  h.context.drafts.push({}, { kind: "impegno", section: null, statement: "Mandare il preventivo entro venerdì.", basis: "dedotto", preselected: false, party: "nostra", roleLabel: "Responsabile del progetto", dueOn: "2026-11-20" });
  h.context.reads.push({ status: "letto", proposals: 2, skipped: { persone: 2 } });
  const who = principal();
  const out = await call(h, "add_context_notes", addArgs(), who);
  assert.equal(out.isError, false, JSON.stringify(out.content));
  const [actor, input] = h.context.calls.addNote[0] as [ContextActor, NewNoteInput];
  assert.deepEqual(actor, { workspaceId: WS, userId: who.userId, role: "transformation_lead", isLateralSpace: true, channel: "claude" });
  assert.deepEqual(input, { title: "Call di avvio", occurredOn: "2026-11-14", body: NOTE_TEXT, participants: PEOPLE, link: "https://notes.example.test/call-di-avvio", origin: "claude", kind: "appunti" });
  assert.deepEqual(h.context.calls.read[0].slice(2), [{ timeoutMs: CONTEXT_MCP_READ_TIMEOUT_MS }]);
  const source = out.content.source as Record<string, unknown>;
  assert.deepEqual(source, {
    id: source.id,
    title: "Call di avvio",
    date: "2026-11-14",
    duplicate: false,
    link: `https://www.theunbundle.com/dashboard/${WS}/contesto/conferma?fonte=${source.id}`,
  });
  assert.deepEqual(out.content.reading, { status: "letto", message: "Letti: 2 proposte da confermare." });
  const [fact, commitment] = out.content.proposals as Array<Record<string, unknown>>;
  assert.equal(fact.kindLabel, "Nuovo");
  assert.equal(fact.basisLabel, "detto");
  assert.equal(fact.sectionLabel, "Sistemi e dati");
  assert.equal(fact.visibilityLabel, "Per tutti");
  assert.deepEqual(commitment.commitment, { party: "nostra", partyLabel: "Nostro", role: "Responsabile del progetto", dueOn: "2026-11-20" });
  assert.equal(commitment.basisLabel, "dedotto");
  assert.deepEqual(out.content.notReported, ["2 passaggi non riportati: parlavano di persone"]);
  assert.equal(out.content.note, CONTEXT_PROPOSALS_NOTE);
  // «Con chi» non esce mai: né qui, né nelle letture e nelle conferme dopo.
  const list = await call(h, "list_context_proposals", {}, who);
  const confirmed = await call(h, "confirm_context_proposals", { confirm: [{ id: fact.id, version: 1 }], idempotencyKey: "contesto-prova-0002", confirmedByUser: true }, who);
  for (const result of [out, list, confirmed]) {
    const text = JSON.stringify(result.content);
    assert.equal(text.includes("Mario"), false);
    assert.equal(text.includes("Bianchi"), false);
    assert.equal(/participants|addedBy|confirmedBy|email/i.test(text), false);
  }
  assert.equal(h.requests.rows.values().next().value?.status, "completed");
});

test("add_context_notes senza data: vale oggi, a Roma", async () => {
  const h = harness();
  const out = await call(h, "add_context_notes", addArgs({ date: undefined }), principal());
  assert.equal(out.isError, false);
  assert.equal((h.context.calls.addNote[0][1] as NewNoteInput).occurredOn, "2026-11-16");
});

test("add_context_notes: la stessa chiave due volte scrive e legge una volta sola; la risposta ripetuta rilegge le proposte", async () => {
  const h = harness();
  h.context.drafts.push({});
  h.context.reads.push({ status: "letto", proposals: 1, skipped: {} });
  const who = principal();
  const first = await call(h, "add_context_notes", addArgs(), who);
  const again = await call(h, "add_context_notes", addArgs(), who);
  assert.deepEqual(again.content, first.content);
  assert.equal(h.context.calls.addNote.length, 1);
  assert.equal(h.context.calls.read.length, 1);
  // Il risultato salvato ha solo id, codici e numeri: mai un testo degli appunti o di una proposta.
  const saved = JSON.stringify([...h.requests.rows.values()].map((row) => row.result));
  assert.equal(saved.includes("SAP"), false);
  assert.equal(saved.includes("Call di avvio"), false);
  // Un'altra chiamata con la stessa chiave e un altro testo: conflitto.
  const other = await call(h, "add_context_notes", addArgs({ text: `${NOTE_TEXT} Altro.` }), who);
  assert.equal(other.content.error, "idempotency_conflict");
});

test("add_context_notes: lo stesso testo con una chiave nuova torna l'appunto di prima, duplicate true", async () => {
  const h = harness();
  const who = principal();
  await call(h, "add_context_notes", addArgs(), who);
  const second = await call(h, "add_context_notes", addArgs({ idempotencyKey: "contesto-prova-0009" }), who);
  assert.equal((second.content.source as { duplicate: boolean }).duplicate, true);
  assert.equal(h.context.sources.size, 1);
});

test("add_context_notes senza l'ok ai sub-responsabili: appunti salvati, nessuna proposta, la richiesta si chiude", async () => {
  const h = harness();
  h.context.reads.push({ status: "ok_mancante" });
  const out = await call(h, "add_context_notes", addArgs(), principal());
  assert.equal(out.isError, false);
  assert.equal(h.context.sources.size, 1, "gli appunti sono salvati");
  assert.equal((out.content.reading as { status: string }).status, "ok_mancante");
  assert.match((out.content.reading as { message: string }).message, /^Appunti salvati\. La lettura parte quando c'è l'ok/);
  assert.deepEqual(out.content.proposals, []);
  assert.equal([...h.requests.rows.values()][0].status, "completed");
});

test("add_context_notes con parti ancora da leggere: risponde «in_corso», la richiesta resta «failed» e la stessa chiamata riprende", async () => {
  const h = harness();
  const who = principal();
  h.context.drafts.push({});
  h.context.reads.push({ status: "in_corso", partsRead: 1, partsTotal: 3 });
  const first = await call(h, "add_context_notes", addArgs(), who);
  assert.equal(first.isError, false);
  assert.equal((first.content.reading as { status: string }).status, "in_corso");
  assert.match((first.content.reading as { message: string }).message, /^Letta la parte 1 di 3\. .*stesso idempotencyKey/);
  assert.equal((first.content.proposals as unknown[]).length, 1, "le proposte della prima parte ci sono già");
  const row = [...h.requests.rows.values()][0];
  assert.equal(row.status, "failed");
  assert.equal(row.result?.sourceId, (first.content.source as { id: string }).id);

  // La ripresa non salva di nuovo: legge la parte dopo, dallo stesso appunto.
  h.context.drafts.push({ statement: "Gli ordini si inseriscono a mano." });
  h.context.reads.push({ status: "letto", proposals: 2, skipped: {} });
  const second = await call(h, "add_context_notes", addArgs(), who);
  assert.equal(h.context.calls.addNote.length, 1);
  assert.equal(h.context.calls.read.length, 2);
  assert.deepEqual(second.content.reading, { status: "letto", message: "Letti: 2 proposte da confermare." });
  assert.equal((second.content.source as { duplicate: boolean }).duplicate, false, "l'appunto l'ha creato questa richiesta");
  assert.equal([...h.requests.rows.values()][0].status, "completed");
});

test("add_context_notes: tempo scaduto, errore e lettura non riuscita danno «da_riprovare» e lasciano riprendere; un rifiuto «non_letto» e chiude", async () => {
  for (const [reading, status, closes] of [
    [{ status: "tempo" }, "da_riprovare", false],
    [{ status: "errore" }, "da_riprovare", false],
    ["fallisce", "da_riprovare", false],
    [{ status: "limite" }, "da_riprovare", false],
    [{ status: "rifiuto" }, "non_letto", true],
  ] as const) {
    const h = harness();
    h.context.reads.push(reading as ReadOutcome | "fallisce");
    const out = await call(h, "add_context_notes", addArgs(), principal());
    assert.equal(out.isError, false, String(status));
    assert.equal((out.content.reading as { status: string }).status, status);
    assert.equal([...h.requests.rows.values()][0].status, closes ? "completed" : "failed", JSON.stringify(reading));
  }
});

test("add_context_notes: dati sanitari negli appunti → invalid_payload su text, niente salvato, la chiave torna libera", async () => {
  const h = harness();
  const out = await call(h, "add_context_notes", addArgs({ text: `${NOTE_TEXT} Il responsabile ha una visita medica.` }), principal());
  assert.deepEqual(out.content, { error: "invalid_payload", message: "Alcuni campi non sono validi: correggi solo quelli indicati in fieldErrors e riprova.", fieldErrors: { text: CONTEXT_TEXT.add.blockedHealth("visita medica") } });
  assert.equal(h.context.calls.read, undefined);
  assert.equal(h.requests.rows.size, 0);
});

// ─── list_context_proposals ──────────────────────────────────────────

test("list_context_proposals: tutte o quelle di un appunto, con gli appunti, le riconferme in fondo, al massimo 75", async () => {
  const h = harness();
  const who = principal();
  h.context.drafts.push({ kind: "conferma", statement: "Il gestionale è sempre SAP." }, {});
  await call(h, "add_context_notes", addArgs(), who);
  h.context.drafts.push(...Array.from({ length: 80 }, (_, i) => ({ statement: `Fatto numero ${i}.` })));
  const other = await call(h, "add_context_notes", addArgs({ text: `${NOTE_TEXT} Seconda call.`, idempotencyKey: "contesto-prova-0003" }), who);
  const otherId = (other.content.source as { id: string }).id;

  const all = await call(h, "list_context_proposals", {}, who);
  assert.equal(all.content.total, 82);
  assert.equal((all.content.proposals as unknown[]).length, 75);
  assert.match(String(all.content.note), /Ne mostro 75 su 82: per le altre chiedi quelle di un appunto, con sourceId\.$/);
  assert.equal((all.content.sources as unknown[]).length, 2);

  const first = await call(h, "list_context_proposals", { sourceId: (h.context.calls.read[0][1] as string) }, who);
  const kinds = (first.content.proposals as McpOut[]).map((p) => p.kind);
  assert.deepEqual(kinds, ["nuovo", "conferma"], "la riconferma in fondo");
  assert.equal((first.content.proposals as Array<{ kindLabel: string }>)[1].kindLabel, "Riconferma");
  assert.equal(first.content.note, CONTEXT_PROPOSALS_NOTE);
  assert.ok(String(first.content.link).endsWith(`/contesto/conferma?fonte=${h.context.calls.read[0][1]}`));
  assert.notEqual(otherId, h.context.calls.read[0][1]);

  const bad = await call(h, "list_context_proposals", { sourceId: "non-un-id" }, who);
  assert.deepEqual(bad.content.fieldErrors, { sourceId: "Formato non valido." });
});

test("i nomi e i contatti degli appunti non arrivano a Claude: né nel testo di una proposta da correggere, né nelle citazioni", async () => {
  const { h, who, list } = await seeded([
    { statement: "Mario Rossi guida il reparto acquisti da tre anni.", quote: "Mario Rossi guida il reparto acquisti da tre anni.", issue: "nome_persona", issueMessage: "Non scrivere nomi di persone: indica il ruolo.", preselected: false },
    { statement: "Gli ordini urgenti arrivano per e-mail.", quote: "Per gli ordini urgenti scrivere a ordini.urgenti@esempio.test entro le 10." },
    { statement: "Il gestionale è SAP Business One.", quote: "Il gestionale è SAP Business One." },
  ]);
  // Tutta la risposta, con la copia in JSON per i client che leggono solo il testo.
  const listed = await callTeamTool("list_context_proposals", {}, who, h.deps);
  for (const out of [JSON.stringify(list), JSON.stringify(listed.result)]) assert.doesNotMatch(out, /Mario|Rossi|ordini\.urgenti@|esempio\.test/);
  const shown = (listed.result.structuredContent as { proposals: Array<{ text: string; quote: string | null; quoteNote: string | null; issue: string | null }> }).proposals;
  assert.deepEqual(
    shown.map((p) => [p.text, p.quote, p.quoteNote, p.issue]),
    [
      ["Testo non mostrato: contiene dati di una persona. Si corregge in Unbundle.", null, "Apri Unbundle per la citazione.", "Non scrivere nomi di persone: indica il ruolo."],
      ["Gli ordini urgenti arrivano per e-mail.", null, "Apri Unbundle per la citazione.", null],
      ["Il gestionale è SAP Business One.", "Il gestionale è SAP Business One.", null, null],
    ],
  );
});

test("i titoli con nomi o e-mail non arrivano a Claude: «Call 14 nov», «Documento 10 nov», «Appunti 14 nov»; un titolo pulito resta", async () => {
  const h = harness();
  const who = principal();
  // Appunti mandati da Claude con un nome nel titolo.
  h.context.drafts.push({});
  const added = await call(h, "add_context_notes", addArgs({ title: "Call con Mario Rossi" }), who);
  assert.equal((added.content.source as { title: string }).title, "Appunti 14 nov");
  // Una call di Granola, un documento e un appunto con un titolo pulito, già in «Contesto».
  const extra = [
    { kind: "appunti" as const, origin: "granola" as const, title: "Allineamento con mario.rossi@cliente.test", occurredOn: "2026-11-14" },
    { kind: "documento" as const, origin: "web" as const, title: "Organigramma di Anna Bianchi", occurredOn: "2026-11-10" },
    { kind: "trascrizione" as const, origin: "granola" as const, title: "Avvio progetto ordini", occurredOn: "2026-11-12" },
  ];
  for (const source of extra) {
    const id = randomUUID();
    h.context.sources.set(id, { id, ...source, body: "x".repeat(40), participants: null, skipped: {} });
    const p = proposal(id);
    h.context.proposals.set(p.id, p);
  }
  const listed = await callTeamTool("list_context_proposals", {}, who, h.deps);
  const titles = (listed.result.structuredContent as { sources: Array<{ title: string }> }).sources.map((source) => source.title).sort();
  assert.deepEqual(titles, ["Appunti 14 nov", "Avvio progetto ordini", "Call 14 nov", "Documento 10 nov"]);
  assert.doesNotMatch(JSON.stringify(listed.result), /Mario|Rossi|Bianchi|mario\.rossi@/);
});

// ─── confirm_context_proposals ───────────────────────────────────────

async function seeded(drafts: Array<Partial<ProposalView>>) {
  const h = harness();
  const who = principal();
  h.context.drafts.push(...drafts);
  const added = await call(h, "add_context_notes", addArgs(), who);
  return { h, who, list: added.content.proposals as McpOut[] };
}

test("confirm: una dedotta senza inferredConfirmed e un conflitto senza resolution → invalid_payload, niente confermato, chiave libera", async () => {
  const { h, who, list } = await seeded([
    { basis: "dedotto", preselected: false },
    { kind: "conflitto", preselected: false, before: { factId: randomUUID(), statement: "Il gestionale è Zucchetti.", sourceLabel: "Discovery", date: "21 ott" } },
    { issue: "nome_persona", issueMessage: "Non scrivere nomi di persone: indica il ruolo.", preselected: false },
  ]);
  const [inferred, conflict, withIssue] = list;
  const out = await call(
    h,
    "confirm_context_proposals",
    {
      confirm: [
        { id: inferred.id, version: 1 },
        { id: conflict.id, version: 1 },
        { id: withIssue.id, version: 1 },
      ],
      idempotencyKey: "contesto-conferma-1",
      confirmedByUser: true,
    },
    who,
  );
  assert.equal(out.content.error, "invalid_payload");
  assert.deepEqual(out.content.fieldErrors, {
    "confirm.0.inferredConfirmed": CONTEXT_INFERRED_MESSAGE,
    "confirm.1.resolution": CONTEXT_CONFLICT_MESSAGE,
    "confirm.2.id": CONTEXT_ISSUE_MESSAGE,
  });
  assert.equal(h.context.calls.confirm, undefined, "niente confermato");
  assert.equal(h.requests.rows.size, 1, "resta solo la richiesta di add_context_notes");
  assert.ok([...h.context.proposals.values()].every((p) => p.status === "aperta"));

  // Con il sì specifico e la scelta della persona entrano; la scelta passa solo per il conflitto.
  const ok = await call(
    h,
    "confirm_context_proposals",
    {
      confirm: [
        { id: inferred.id, version: 1, inferredConfirmed: true, resolution: "ora" },
        { id: conflict.id, version: 1, resolution: "prima" },
      ],
      idempotencyKey: "contesto-conferma-1",
      confirmedByUser: true,
    },
    who,
  );
  assert.equal(ok.isError, false, JSON.stringify(ok.content));
  assert.deepEqual(h.context.calls.confirm[0][1], [
    { id: inferred.id, version: 1 },
    { id: conflict.id, version: 1, resolution: "prima" },
  ]);
});

test("confirm: una proposta cambiata, una già decisa o due volte nella richiesta non confermano niente", async () => {
  const { h, who, list } = await seeded([{}, {}]);
  const [a, b] = list;
  const stale = await call(h, "confirm_context_proposals", { confirm: [{ id: a.id, version: 1 }, { id: b.id, version: 2 }], discard: [randomUUID()], idempotencyKey: "contesto-conferma-2", confirmedByUser: true }, who);
  assert.deepEqual(stale.content, {
    error: "version_conflict",
    message: CONTEXT_PROPOSALS_CHANGED_MESSAGE,
    fieldErrors: { "confirm.1.version": "È cambiata dopo che l'hai letta: rileggila con list_context_proposals.", "discard.0": CONTEXT_GONE_MESSAGE },
  });
  const twice = await call(h, "confirm_context_proposals", { confirm: [{ id: a.id, version: 1 }], discard: [a.id.toUpperCase()], idempotencyKey: "contesto-conferma-3", confirmedByUser: true }, who);
  assert.deepEqual(twice.content.fieldErrors, { "discard.0": CONTEXT_TWICE_MESSAGE });
  assert.equal(h.context.calls.confirm, undefined);
  assert.equal(h.context.calls.discard, undefined);
  // La conferma che arriva tardi (un'altra persona ha appena confermato): version_conflict, niente scritto, chiave libera.
  h.context.failNext.confirm = { ok: false, error: "versione_superata", message: "x" };
  const late = await call(h, "confirm_context_proposals", { confirm: [{ id: a.id, version: 1 }], idempotencyKey: "contesto-conferma-4", confirmedByUser: true }, who);
  assert.deepEqual(late.content, { error: "version_conflict", message: CONTEXT_PROPOSALS_CHANGED_MESSAGE });
  assert.equal([...h.requests.rows.keys()].some((k) => k.endsWith("contesto-conferma-4")), false);
});

test("confirm: conferma e scarta, «In breve» dopo la risposta una volta sola; la stessa chiave risponde uguale senza riscrivere", async () => {
  const { h, who, list } = await seeded([{}, { kind: "impegno", section: null, party: "cliente", roleLabel: "Ufficio acquisti" }, {}]);
  const [fact, commitment, other] = list;
  const args = { confirm: [{ id: fact.id, version: 1 }, { id: commitment.id, version: 1 }], discard: [other.id], idempotencyKey: "contesto-conferma-5", confirmedByUser: true };
  const out = await call(h, "confirm_context_proposals", args, who);
  assert.deepEqual(out.content, {
    duplicate: false,
    confirmed: 2,
    discarded: 1,
    newFacts: 1,
    changedFacts: 0,
    reconfirmed: 0,
    commitments: 1,
    questions: 0,
    remaining: 0,
    link: `https://www.theunbundle.com/dashboard/${WS}/contesto`,
  });
  assert.deepEqual(h.context.briefs, [WS]);
  const again = await call(h, "confirm_context_proposals", args, who);
  assert.deepEqual(again.content, { ...out.content, duplicate: true });
  assert.equal(h.context.calls.confirm.length, 1);
  assert.equal(h.context.calls.discard.length, 1);
  assert.deepEqual(h.context.briefs, [WS], "una conferma ripetuta non riscrive «In breve»");
});

test("confirm: solo scartare non riscrive «In breve»; remaining conta le proposte rimaste", async () => {
  const { h, who, list } = await seeded([{}, {}]);
  const out = await call(h, "confirm_context_proposals", { discard: [list[0].id], idempotencyKey: "contesto-conferma-6", confirmedByUser: true }, who);
  assert.equal(out.content.discarded, 1);
  assert.equal(out.content.confirmed, 0);
  assert.equal(out.content.remaining, 1);
  assert.ok(String(out.content.link).endsWith("/contesto/conferma"));
  assert.deepEqual(h.context.briefs, []);
  const empty = await call(h, "confirm_context_proposals", { confirm: [], idempotencyKey: "contesto-conferma-7", confirmedByUser: true }, who);
  assert.deepEqual(empty.content.fieldErrors, { confirm: "Indica almeno una proposta da confermare o da scartare." });
});

test("confirm a metà: confermate sì, scarto non riuscito; la stessa chiave non riconferma e scarta", async () => {
  const { h, who, list } = await seeded([{}, {}]);
  const args = { confirm: [{ id: list[0].id, version: 1 }], discard: [list[1].id], idempotencyKey: "contesto-conferma-8", confirmedByUser: true };
  h.context.failNext.discard = { ok: false, error: "riprova", message: "x" };
  const first = await call(h, "confirm_context_proposals", args, who);
  assert.equal(first.content.error, "riprova");
  assert.match(String(first.content.message), /Le proposte confermate restano: richiama con lo stesso idempotencyKey/);
  assert.equal([...h.requests.rows.values()].find((r) => r.tool === "confirm_context_proposals")?.status, "failed");
  const second = await call(h, "confirm_context_proposals", args, who);
  assert.equal(second.isError, false, JSON.stringify(second.content));
  assert.equal(h.context.calls.confirm.length, 1, "la conferma non si rifà");
  assert.equal(h.context.calls.discard.length, 2);
  assert.deepEqual([second.content.confirmed, second.content.discarded, second.content.remaining], [1, 1, 0]);
  assert.deepEqual(h.context.briefs, [WS]);
});

// ═══ (9b) Le letture della memoria: get_context, ask_context, list_context_commitments ═══

type Section = { section: string; sectionLabel: string; facts: Array<Record<string, unknown>> };
const CLIENT = { isLateralSpace: false, role: "function_lead" } as const;
const factTexts = (out: Out) => (out.content.sections as Section[]).flatMap((section) => section.facts.map((f) => f.text));
const commitmentTexts = (out: Out) => (out.content.commitments as Array<{ text: string }>).map((c) => c.text);

test("get_context per Lateral Space: «In breve», i fatti per sezione con fonte, data, segni, visibilità e use case; impegni e domande", async () => {
  const h = harness();
  const out = await call(h, "get_context", {}, principal());
  assert.equal(out.isError, false, JSON.stringify(out.content));
  const [sap, budget, phone] = h.context.seed.facts;
  const [preventivo, fatture, acquisti] = h.context.seed.commitments;
  const [soglia, confermato] = h.context.seed.questions;
  assert.deepEqual(Object.keys(out.content), ["brief", "sections", "more", "commitments", "questions", "counts", "link", "note"]);
  assert.deepEqual(out.content.brief, h.context.seed.brief);
  const sections = out.content.sections as Section[];
  assert.deepEqual(
    sections.map((s) => [s.section, s.sectionLabel]),
    [
      ["lavoro", "Come lavorano"],
      ["sistemi", "Sistemi e dati"],
      ["regole", "Regole e vincoli"],
    ],
    "nell'ordine della Memoria, solo le sezioni con fatti",
  );
  assert.deepEqual(sections[0].facts, [
    { id: phone.id, text: phone.statement, source: "Call 14 nov", lastConfirmedOn: "2026-05-02", toCheck: true, inferred: true, visibilityLabel: "Per tutti", useCases: ["XX-0012", "XX-0013"] },
  ]);
  assert.deepEqual(sections[1].facts, [
    { id: sap.id, text: sap.statement, source: "Call 14 nov", lastConfirmedOn: "2026-11-14", toCheck: false, inferred: false, visibilityLabel: "Per tutti", useCases: ["XX-0012"] },
  ]);
  assert.deepEqual(sections[2].facts, [
    { id: budget.id, text: budget.statement, source: "Scritto a mano", lastConfirmedOn: "2026-11-10", toCheck: false, inferred: false, visibilityLabel: "Solo Lateral Space", useCases: [] },
  ]);
  // Gli impegni per scadenza (senza scadenza in fondo), nostri e del cliente insieme; per parte e ruolo, mai per persona.
  assert.deepEqual(out.content.commitments, [
    { id: preventivo.id, text: "Mandare il preventivo.", party: "nostra", partyLabel: "Nostro", role: "Responsabile del progetto", dueOn: "2026-11-10", overdue: true, useCases: ["XX-0012"], visibilityLabel: "Per tutti" },
    { id: fatture.id, text: "Inviare l'esportazione delle fatture.", party: "cliente", partyLabel: "Del cliente", role: "Ufficio amministrazione", dueOn: "2026-11-25", overdue: false, useCases: [], visibilityLabel: "Solo Lateral Space" },
    { id: acquisti.id, text: "Confermare chi approva gli acquisti.", party: "cliente", partyLabel: "Del cliente", role: "Direzione acquisti", dueOn: null, overdue: false, useCases: ["XX-0013"], visibilityLabel: "Per tutti" },
  ]);
  assert.deepEqual(out.content.questions, [
    { id: soglia.id, text: "Chi approva gli acquisti sopra soglia?", askWhom: "Direzione acquisti", useCases: ["XX-0013"], visibilityLabel: "Per tutti" },
    { id: confermato.id, text: "Il budget è già confermato?", askWhom: null, useCases: [], visibilityLabel: "Solo Lateral Space" },
  ]);
  assert.deepEqual(out.content.counts, { facts: 3, commitments: 3, questions: 2 });
  assert.equal(out.content.more, 0);
  assert.equal(out.content.link, `https://www.theunbundle.com/dashboard/${WS}/contesto`);
  assert.equal(out.content.note, CONTEXT_MEMORY_NOTE);
});

test("get_context non tocca «Novità per te»: la memoria si legge con touchSeen false, e le novità non escono", async () => {
  const h = harness();
  const out = await call(h, "get_context", { useCase: "XX-0012", section: "sistemi", since: "2026-11-01" }, principal());
  assert.equal(out.isError, false);
  assert.deepEqual(
    h.context.calls.memory.map((args) => args[1]),
    [{ touchSeen: false }],
  );
  assert.equal(/novelties|Novità/.test(JSON.stringify(out.content)), false);
});

test("get_context per una persona del cliente: solo «Per tutti» e mai visibilityLabel, anche se una lettura sbagliasse", async () => {
  for (const leak of [false, true]) {
    const h = harness({ leak });
    const out = await call(h, "get_context", {}, principal(CLIENT));
    assert.equal(out.isError, false, JSON.stringify(out.content));
    const text = JSON.stringify(out.content);
    assert.equal(text.includes("budget"), false, `leak ${leak}: né il fatto né la domanda «Solo Lateral Space»`);
    assert.equal(text.includes("esportazione"), false, `leak ${leak}: né l'impegno «Solo Lateral Space»`);
    assert.equal(text.includes("visibilityLabel"), false, `leak ${leak}`);
    assert.equal(text.includes("Solo Lateral Space"), false, `leak ${leak}`);
    assert.deepEqual(out.content.counts, { facts: 2, commitments: 2, questions: 1 });
    const [actor] = h.context.calls.memory[0] as [ContextActor];
    assert.equal(actor.isLateralSpace, false, "la memoria si legge come la persona del token");
  }
});

test("get_context: use case per codice (anche in minuscolo), sezione e since; uno use case che non c'è not_found; un giorno che non esiste invalid_payload", async () => {
  const h = harness();
  const who = principal();
  const byCase = await call(h, "get_context", { useCase: "xx-0013" }, who);
  assert.deepEqual(factTexts(byCase), ["Gli ordini arrivano soprattutto per telefono."]);
  assert.deepEqual(commitmentTexts(byCase), ["Confermare chi approva gli acquisti."]);
  assert.deepEqual((byCase.content.questions as Array<{ text: string }>).map((q) => q.text), ["Chi approva gli acquisti sopra soglia?"]);
  assert.deepEqual(byCase.content.brief, h.context.seed.brief, "«In breve» resta");
  assert.deepEqual(byCase.content.counts, { facts: 1, commitments: 1, questions: 1 });
  // La sezione vale per i fatti; impegni e domande restano.
  const bySection = await call(h, "get_context", { section: "regole" }, who);
  assert.deepEqual(factTexts(bySection), ["Il budget del progetto non è ancora approvato."]);
  assert.deepEqual(bySection.content.counts, { facts: 1, commitments: 3, questions: 2 });
  // since: i fatti nati da quel giorno, nuovi o versioni nuove. Il budget è nato il 1° ottobre e riconfermato il 10
  // novembre: una riconferma non è una novità.
  const since = await call(h, "get_context", { since: "2026-11-01" }, who);
  assert.deepEqual(factTexts(since), ["Il gestionale è SAP Business One."]);
  assert.deepEqual(since.content.counts, { facts: 1, commitments: 3, questions: 2 });
  assert.deepEqual(factTexts(await call(h, "get_context", { since: "2026-11-14" }, who)), ["Il gestionale è SAP Business One."], "il giorno stesso conta");
  assert.deepEqual(factTexts(await call(h, "get_context", { since: "2026-11-15" }, who)), []);

  const missing = await call(h, "get_context", { useCase: "XX-0099" }, who);
  assert.deepEqual(missing.content, { error: "not_found", message: TEAM_MCP_ERROR_MESSAGES.not_found });
  const badDay = await call(h, "get_context", { since: "2026-02-30" }, who);
  assert.deepEqual(badDay.content, { error: "invalid_payload", message: TEAM_MCP_ERROR_MESSAGES.invalid_payload, fieldErrors: { since: CONTEXT_TEXT.errors.dateInvalid } });
  assert.deepEqual((await call(h, "get_context", { since: "01/11/2026" }, who)).content.fieldErrors, { since: "Formato non valido." });
  for (const bad of [{ section: "domande" }, { useCase: "  " }, { useCase: "X".repeat(41) }, { persona: "Mario Rossi" }, { addedBy: "x" }, { confirmedBy: "x" }]) {
    assert.equal((await call(h, "get_context", bad, who)).content.error, "invalid_payload", JSON.stringify(bad));
  }
  assert.equal(h.context.calls.memory.length, 5, "un errore nell'ingresso o uno use case che non c'è non leggono la memoria");
});

test("get_context: al massimo 200 fatti, i più recenti; gli altri si contano in more", async () => {
  const h = harness();
  const months = ["01", "02", "03", "04", "05", "06", "07", "08", "09"];
  h.context.seed.facts.push(
    ...Array.from({ length: 210 }, (_, i) => fact({ statement: `Fatto di prova numero ${i}.`, section: "azienda", lastConfirmedOn: `2026-${months[i % 9]}-01`, createdOn: "2026-01-01" })),
  );
  const out = await call(h, "get_context", {}, principal());
  const shown = new Set((out.content.sections as Section[]).flatMap((s) => s.facts.map((f) => f.id as string)));
  assert.equal(shown.size, CONTEXT_MCP_FACTS_MAX);
  assert.equal(out.content.more, 13);
  assert.deepEqual(out.content.counts, { facts: 213, commitments: 3, questions: 2 });
  const left = h.context.seed.facts.filter((f) => !shown.has(f.id));
  assert.equal(left.length, 13);
  assert.ok(left.every((f) => f.lastConfirmedOn === "2026-01-01"), "restano fuori i meno recenti");
  assert.ok(h.context.seed.facts.slice(0, 3).every((f) => shown.has(f.id)));
});

test("list_context_commitments: aperti per scadenza; filtri per parte, use case e scaduti; il totale; il cliente senza «Solo Lateral Space»", async () => {
  const h = harness();
  const who = principal();
  const all = await call(h, "list_context_commitments", {}, who);
  assert.equal(all.isError, false, JSON.stringify(all.content));
  assert.deepEqual(Object.keys(all.content), ["commitments", "total", "link"]);
  assert.deepEqual(commitmentTexts(all), ["Mandare il preventivo.", "Inviare l'esportazione delle fatture.", "Confermare chi approva gli acquisti."]);
  assert.equal(all.content.total, 3);
  assert.equal(all.content.link, `https://www.theunbundle.com/dashboard/${WS}/contesto`);
  assert.deepEqual((all.content.commitments as unknown[])[1], {
    id: h.context.seed.commitments[1].id,
    text: "Inviare l'esportazione delle fatture.",
    party: "cliente",
    partyLabel: "Del cliente",
    role: "Ufficio amministrazione",
    dueOn: "2026-11-25",
    overdue: false,
    useCases: [],
    visibilityLabel: "Solo Lateral Space",
  });
  assert.deepEqual(commitmentTexts(await call(h, "list_context_commitments", { party: "cliente" }, who)), ["Inviare l'esportazione delle fatture.", "Confermare chi approva gli acquisti."]);
  assert.deepEqual(commitmentTexts(await call(h, "list_context_commitments", { useCase: "XX-0012" }, who)), ["Mandare il preventivo."]);
  assert.deepEqual(commitmentTexts(await call(h, "list_context_commitments", { overdueOnly: true }, who)), ["Mandare il preventivo."]);
  const none = await call(h, "list_context_commitments", { party: "nostra", useCase: "XX-0013" }, who);
  assert.deepEqual([none.content.commitments, none.content.total], [[], 0]);
  assert.equal((await call(h, "list_context_commitments", { useCase: "XX-0099" }, who)).content.error, "not_found");
  // La lettura degli impegni non chiede gli use case dei fatti e delle domande.
  const [, ids] = h.context.calls.links[0] as [ContextActor, { factIds: string[]; commitmentIds: string[]; questionIds: string[] }];
  assert.deepEqual([ids.factIds, ids.questionIds, ids.commitmentIds.length], [[], [], 3]);

  const client = await call(h, "list_context_commitments", {}, principal({ isLateralSpace: false, role: "analyst" }));
  assert.deepEqual(commitmentTexts(client), ["Mandare il preventivo.", "Confermare chi approva gli acquisti."]);
  assert.equal(JSON.stringify(client.content).includes("visibilityLabel"), false);
  // Mai un filtro sulla persona, nemmeno sul ruolo.
  for (const key of ["persona", "owner", "assignee", "userId", "email", "role", "chi"]) {
    assert.equal((await call(h, "list_context_commitments", { [key]: "x" }, who)).content.error, "invalid_payload", key);
  }
});

function askSource(over: Partial<AskSource> & Pick<AskSource, "kind" | "excerpt">): AskSource {
  return { n: 1, label: "Call 14 nov", date: "2026-11-14", ...over };
}

test("ask_context: risposta con le fonti, «non lo sappiamo», solo i brani senza l'ok, niente; troppe domande rate_limited; errori di askContext", async () => {
  const h = harness();
  const who = principal(CLIENT);
  const known = askSource({ kind: "fatto", excerpt: "Il gestionale è SAP Business One." });
  h.context.asks.push(
    { ok: true, value: { status: "risposta", answer: "Usano SAP Business One [1].", sources: [known] } },
    { ok: true, value: { status: "non_so", sources: [known] } },
    { ok: true, value: { status: "solo_ricerca", sources: [known] } },
    { ok: true, value: { status: "niente" } },
    { ok: true, value: { status: "limite", retryAfterSeconds: 42 } },
    { ok: false, error: "dati_non_validi", message: "x", fieldErrors: { question: CONTEXT_TEXT.add.blockedHealth("visita medica") } },
    { ok: false, error: "riprova", message: "x" },
  );
  const ask = () => call(h, "ask_context", { question: "  Che gestionale usano?  " }, who);
  const shownSource = { n: 1, kindLabel: "Fatto", label: "Call 14 nov", date: "2026-11-14", excerpt: "Il gestionale è SAP Business One.", excerptNote: null };
  const answered = await ask();
  assert.deepEqual(answered.content, { status: "risposta", answer: "Usano SAP Business One [1].", sources: [shownSource], note: CONTEXT_MEMORY_NOTE });
  assert.deepEqual(h.context.calls.ask[0].slice(1), ["Che gestionale usano?"], "la domanda senza spazi in più");
  assert.deepEqual((h.context.calls.ask[0][0] as ContextActor).isLateralSpace, false);
  assert.deepEqual((await ask()).content, { status: "non_so", answer: null, sources: [shownSource], note: CONTEXT_MEMORY_NOTE });
  assert.deepEqual((await ask()).content, { status: "solo_ricerca", answer: null, sources: [shownSource], note: CONTEXT_MEMORY_NOTE });
  assert.deepEqual((await ask()).content, { status: "niente", answer: null, sources: [], note: CONTEXT_MEMORY_NOTE });
  assert.deepEqual((await ask()).content, { error: "rate_limited", message: CONTEXT_TEXT.ask.limit, retryAfterSeconds: 42 });
  assert.deepEqual((await ask()).content, {
    error: "invalid_payload",
    message: TEAM_MCP_ERROR_MESSAGES.invalid_payload,
    fieldErrors: { question: CONTEXT_TEXT.add.blockedHealth("visita medica") },
  });
  assert.deepEqual((await ask()).content, { error: "riprova", message: CONTEXT_TEXT.ask.failed });
  // Una domanda troppo corta, o con un campo in più, non arriva a askContext.
  const calls = h.context.calls.ask.length;
  assert.deepEqual((await call(h, "ask_context", { question: "ok" }, who)).content.fieldErrors, { question: "Almeno 3 caratteri." });
  assert.equal((await call(h, "ask_context", { question: "Che gestionale usano?", visibility: "ls" }, who)).content.error, "invalid_payload");
  assert.equal(h.context.calls.ask.length, calls);
});

test("ask_context: un brano di appunti con un nome esce senza testo, con «Apri Unbundle per il brano.»; un titolo con un nome diventa neutro; una risposta con un nome vale «non lo sappiamo»", async () => {
  const h = harness();
  const who = principal();
  const sources: AskSource[] = [
    { n: 1, kind: "appunti", label: "Call con Mario Rossi", date: "2026-11-14", excerpt: "Mario Rossi dice che gli ordini arrivano per telefono." },
    { n: 2, kind: "appunti", label: "Call di avvio", date: "2026-11-12", excerpt: "Gli ordini arrivano quasi tutti per telefono." },
    { n: 3, kind: "documento", label: "Organigramma di Anna Bianchi", date: "2026-11-10", excerpt: "Ufficio acquisti e ufficio amministrazione." },
    { n: 4, kind: "fatto", label: "Call 14 nov", date: "2026-11-14", excerpt: "Il gestionale è SAP Business One." },
  ];
  h.context.asks.push(
    { ok: true, value: { status: "solo_ricerca", sources } },
    { ok: true, value: { status: "risposta", answer: "Gli ordini li segue Mario Rossi, dell'ufficio acquisti [1].", sources: [sources[0]] } },
  );
  const found = await call(h, "ask_context", { question: "Come arrivano gli ordini?" }, who);
  assert.deepEqual(found.content.sources, [
    { n: 1, kindLabel: "Appunti", label: "Appunti 14 nov", date: "2026-11-14", excerpt: null, excerptNote: CONTEXT_EXCERPT_HIDDEN },
    { n: 2, kindLabel: "Appunti", label: "Call di avvio", date: "2026-11-12", excerpt: "Gli ordini arrivano quasi tutti per telefono.", excerptNote: null },
    { n: 3, kindLabel: "Documento", label: "Documento 10 nov", date: "2026-11-10", excerpt: "Ufficio acquisti e ufficio amministrazione.", excerptNote: null },
    { n: 4, kindLabel: "Fatto", label: "Call 14 nov", date: "2026-11-14", excerpt: "Il gestionale è SAP Business One.", excerptNote: null },
  ]);
  assert.equal(CONTEXT_EXCERPT_HIDDEN, "Apri Unbundle per il brano.");
  const named = await call(h, "ask_context", { question: "Chi segue gli ordini?" }, who);
  assert.deepEqual([named.content.status, named.content.answer], ["non_so", null]);
  for (const out of [found, named]) assert.doesNotMatch(JSON.stringify(out.content), /Mario|Rossi|Bianchi/);
});

test("nessuna lettura porta citazioni, «Con chi», chi ha confermato o aggiunto, anche se la vista li avesse", async () => {
  const h = harness();
  const who = principal();
  h.context.asks.push({ ok: true, value: { status: "solo_ricerca", sources: [askSource({ kind: "fatto", excerpt: "Il gestionale è SAP Business One." })] } });
  const outs = [
    await call(h, "get_context", {}, who),
    await call(h, "list_context_commitments", {}, who),
    await call(h, "ask_context", { question: "Che gestionale usano?" }, who),
  ];
  for (const out of outs) {
    assert.equal(out.isError, false, JSON.stringify(out.content));
    const text = JSON.stringify(out.content);
    assert.doesNotMatch(text, /Mario|Rossi|Bianchi|mario\.rossi@|Lo ha detto/);
    assert.doesNotMatch(text, /"(quote|quoteNote|participants|confirmedBy|addedBy|email|userId)"/);
  }
});

test("le tre letture: anche un token «Solo lettura» del cliente; una lettura nei secchi di oggi; senza la 0038 riprova; gli use case che non si leggono riprova", async () => {
  const reader = principal({ ...CLIENT, scopes: [TEAM_MCP_READ_SCOPE] });
  assert.deepEqual([...CONTEXT_MEMORY_TOOL_NAMES], ["get_context", "ask_context", "list_context_commitments"]);
  const args = (name: string) => (name === "ask_context" ? { question: "Che gestionale usano?" } : {});
  const h = harness();
  for (const name of CONTEXT_MEMORY_TOOL_NAMES) {
    const before = h.limits.buckets.length;
    const out = await call(h, name, args(name), reader);
    assert.equal(out.isError, false, `${name}: ${JSON.stringify(out.content)}`);
    assert.deepEqual(h.limits.buckets.slice(before), [`team:${reader.tokenId}:read`], `${name}: una lettura`);
  }
  assert.equal(h.requests.rows.size, 0, "le letture non toccano l'archivio dell'idempotenza");

  const off = harness({ ready: false });
  for (const name of CONTEXT_MEMORY_TOOL_NAMES) {
    assert.deepEqual((await call(off, name, args(name), reader)).content, { error: "riprova", message: CONTEXT_TEXT.errors.notReady }, name);
  }
  assert.deepEqual(off.context.calls, {});
  assert.equal(off.limits.queries(), 0, "nessun limite consumato senza la 0038");

  const broken = harness({ linksFail: true });
  for (const name of ["get_context", "list_context_commitments"] as const) {
    assert.deepEqual((await call(broken, name, {}, reader)).content, { error: "riprova", message: CONTEXT_TEXT.errors.retry }, name);
  }
});

test("app-deps: la memoria con le opzioni dell'handler, gli use case da loadContextLinks, la domanda da askContext; qui nessun modello", () => {
  const deps = readFileSync(new URL("./app-deps.ts", import.meta.url), "utf8");
  assert.match(deps, /memory: \(actor, opts\) => loadContextMemory\(actor, opts\),/);
  assert.match(deps, /links: \(actor, ids\) => loadContextLinks\(actor, ids\),/);
  assert.match(deps, /ask: \(actor, question\) => askContext\(actor, question\),/);
  assert.match(deps, /import \{ loadContextMemory \} from "@\/lib\/db\/queries\/context-memory";/);
  assert.match(deps, /import \{ askContext \} from "@\/lib\/db\/queries\/context-ask";/);
  const tools = readFileSync(new URL("./context-tools.ts", import.meta.url), "utf8");
  assert.equal(tools.match(/deps\.memory\(/g)?.length, 1);
  assert.match(tools, /const memory = await deps\.memory\(actor, \{ touchSeen: false \}\);/);
  // Il modello lo chiama solo askContext, dopo l'ok ai sub-responsabili: questo modulo non lo importa.
  assert.doesNotMatch(tools, /from "[^"]*\/ai\/|generateContextAsk|anthropic/i);
});

test("context-team.ts: ogni lettura sta nel workspace e, per chi non è di Lateral Space, solo su «Per tutti»; mai citazioni o persone", () => {
  const source = readFileSync(new URL("../../db/queries/context-team.ts", import.meta.url), "utf8");
  const queries = [...source.matchAll(/FROM (context_facts|context_commitments|context_questions) (\w)\b[\s\S]*?`\)/g)];
  assert.deepEqual(
    queries.map((q) => q[1]),
    ["context_facts", "context_commitments", "context_questions"],
  );
  for (const [query, table, alias] of queries) {
    assert.match(query, new RegExp(`WHERE ${alias}\\.workspace_id = \\$\\{ws\\}::uuid`), table);
    assert.match(query, new RegExp(`\\(\\$\\{lateralSpace\\} OR ${alias}\\.visibility = 'tutti'\\)`), table);
  }
  assert.match(source, /const lateralSpace = abilities\.seesLateralSpace;/);
  assert.match(source, /if \(!abilities\.canOpen \|\| !isUuid\(actor\.workspaceId\) \|\| !\(await contextStoreReady\(\)\)\) return null;/);
  assert.match(source, /FROM use_cases WHERE workspace_id = \$\{ws\}::uuid AND id = ANY/);
  assert.doesNotMatch(source, /\bquote\b|confirmed_by_user_id|participants|added_by_user_id|\busers\b/);
});
