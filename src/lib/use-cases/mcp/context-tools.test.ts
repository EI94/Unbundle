import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { CONTEXT_TEXT } from "../../context/text.ts";
import { contextActorFromPrincipal, type ContextActor } from "../../context/visibility.ts";
import type { ProposalKind, SkippedCounts } from "../../context/vocab.ts";
import type { ConfirmItem, OpenProposals, ProposalView } from "../../db/queries/context-proposals.ts";
import type { ReadOutcome } from "../../db/queries/context-read.ts";
import type { NewNoteInput } from "../../db/queries/context-sources.ts";
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
  CONTEXT_MCP_READ_TIMEOUT_MS,
  CONTEXT_PROPOSALS_CHANGED_MESSAGE,
  CONTEXT_TWICE_MESSAGE,
  type TeamContextDeps,
} from "./context-tools.ts";
import { READ_ONLY_TOKEN_MESSAGE, type TeamToolName } from "./contract.ts";
import { decideExistingTeamRequest } from "./idempotency.ts";
import { CONTEXT_PROPOSALS_NOTE } from "./output.ts";
import { callTeamTool, type TeamToolDeps } from "./tools.ts";

// I tre strumenti di «Contesto» dell'MCP del team con dipendenze finte (RILASCIO-9a-COSTRUZIONE.md §9, §11.4): chi
// può, il sì della persona (dedotte, conflitti, proposte da correggere), l'idempotenza (una scrittura sola per chiave,
// la ripresa di una lettura a metà), nessun «Con chi» nelle uscite, appunti salvati e non letti senza l'ok. Le stesse
// regole con il database e il Claude finto sono in `mcp.integration.test.ts`.

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

/** Il limite delle richieste: sempre sotto il tetto, contando le chiamate. */
function memoryLimits() {
  let queries = 0;
  const exec = async (text: string, params: unknown[]) => {
    queries += 1;
    if (!String(text).includes("WITH clock")) return [];
    const rules = JSON.parse(String(params[0])) as Array<{ bucket: string; lim: number; cost: number }>;
    return rules.map((r) => ({ bucket: r.bucket, lim: r.lim, used: 0, cost: r.cost, after_count: r.cost, allowed: true, retry_after: 0 }));
  };
  return { exec, queries: () => queries };
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

/**
 * «Contesto» in memoria, con le regole delle funzioni condivise che contano qui: solo Lateral Space, lo stesso testo
 * una volta sola, «visita medica» fermato, conferma tutte o nessuna. La lettura risponde dalla coda `reads`; una
 * lettura «letto» mette le proposte di `drafts` sull'appunto.
 */
function memoryContext(opts: { ready?: boolean } = {}) {
  const sources = new Map<string, { id: string; title: string; occurredOn: string; body: string; participants: string | null; skipped: SkippedCounts }>();
  const proposals = new Map<string, Stored>();
  const calls: Record<string, unknown[][]> = {};
  const reads: Array<ReadOutcome | "fallisce"> = [];
  const drafts: Array<Partial<ProposalView>> = [];
  const briefs: string[] = [];
  const failNext: Partial<Record<"confirm" | "discard", ServiceResult<never>>> = {};
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
      sources.set(id, { id, title: input.title, occurredOn: input.occurredOn, body: input.body, participants: input.participants ?? null, skipped: {} });
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
        sources: used.map((s) => ({ id: s.id, kind: "appunti" as const, title: s.title, occurredOn: s.occurredOn, skipped: s.skipped })),
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
  };
  return { deps, sources, proposals, calls, reads, drafts, briefs, failNext };
}

function harness(opts: { ready?: boolean } = {}) {
  const requests = memoryRequests();
  const limits = memoryLimits();
  const context = memoryContext(opts);
  const deps = {
    isAreaOn: () => true,
    rateLimitExec: limits.exec,
    random: () => 0.5,
    appOrigin: "https://www.theunbundle.com",
    log: { error() {} },
    reads: {} as TeamToolDeps["reads"],
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
