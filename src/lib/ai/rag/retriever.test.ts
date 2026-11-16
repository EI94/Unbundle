import test from "node:test";
import assert from "node:assert/strict";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { installAppModules, recordLogs } from "../claude-test-kit.ts";

// (Rilascio 9a, RILASCIO-9a-COSTRUZIONE.md §10.4) La memoria della chat e la ricerca nei documenti: un messaggio con
// dati di una persona non entra nella memoria; i frammenti di un documento «Solo Lateral Space» non tornano a chi non
// è di Lateral Space. Il modulo è quello vero; il database è finto e registra che cosa gli si chiede.

type Prova = { inserted: Array<Record<string, unknown>>; wheres: SQL[]; storeState: "pronto" | "assente" | "sconosciuto"; insertFails: boolean };
const prova: Prova = { inserted: [], wheres: [], storeState: "pronto", insertFails: false };
(globalThis as { __prova?: Prova }).__prova = prova;

await installAppModules({
  "@/lib/db": `
    const chain = () => { const c = { from: () => c, where: (w) => { globalThis.__prova.wheres.push(w); return c; }, orderBy: () => c, limit: async () => [] }; return c; };
    export const db = {
      select: () => chain(),
      insert: () => ({ values: async (row) => { if (globalThis.__prova.insertFails) throw new Error("testo riservato del messaggio"); globalThis.__prova.inserted.push(row); } }),
    };`,
  "@/lib/db/queries/context-store": `export async function contextStoreState() { return globalThis.__prova.storeState; }
    export async function contextStoreReady() { return globalThis.__prova.storeState === "pronto"; }`,
});
const { retrieveRelevantContext, indexConversationMessage } = await import("./retriever.ts");

const WS = "00000000-0000-4000-8000-00000000d001";
const CONV = "00000000-0000-4000-8000-00000000d002";
const dialect = new PgDialect();
const text = (where: SQL) => dialect.sqlToQuery(where).sql;
const LS_ONLY = /AND NOT EXISTS \(SELECT 1 FROM context_sources s WHERE s\.document_id = "document_chunks"\."document_id" AND s\.visibility = 'ls'\)/;

function reset(over: Partial<Prova> = {}) {
  Object.assign(prova, { inserted: [], wheres: [], storeState: "pronto", insertFails: false }, over);
}

test("un messaggio senza dati di persone entra nella memoria della chat, tagliato a 5.000 caratteri", async () => {
  reset();
  const message = "Il magazzino riceve la merce ogni mattina e prepara le spedizioni entro mezzogiorno.";
  await indexConversationMessage(CONV, WS, message, "user");
  assert.deepEqual(prova.inserted, [{ conversationId: CONV, workspaceId: WS, content: message, role: "user" }]);
  await indexConversationMessage(CONV, WS, "parola ".repeat(2000), "assistant");
  assert.equal(String(prova.inserted[1].content).length, 5000);
  // Sotto i 30 caratteri non si indicizza, come prima.
  await indexConversationMessage(CONV, WS, "Troppo corto.", "user");
  assert.equal(prova.inserted.length, 2);
});

test("un messaggio con un nome, un contatto, un codice fiscale, una data di nascita o dati sanitari non entra; nel log solo il motivo", async (t) => {
  const lines = recordLogs(t);
  reset();
  const cases: Array<[string, string]> = [
    ["Mario Rossi decide gli acquisti e approva gli ordini sopra i diecimila euro.", "nome_persona"],
    ["Per gli ordini urgenti si scrive direttamente a ordini@esempio.test ogni mattina.", "contatto"],
    ["Il responsabile del magazzino risponde al numero +39 333 1234567 fino alle 18.", "contatto"],
    ["Il codice fiscale del titolare, che serve per il contratto, è RSSMRA80A01H501U.", "codice_fiscale"],
    ["Il titolare è nato il 12/03/1970 e guida l'azienda da quando aveva trent'anni.", "data_nascita"],
    ["Il responsabile acquisti è assente da un mese per una visita medica e una terapia.", "sanitario"],
  ];
  for (const [message] of cases) await indexConversationMessage(CONV, WS, message, "user");
  assert.deepEqual(prova.inserted, [], "nessuno è entrato nella memoria");
  assert.deepEqual(lines, cases.map(([, reason]) => `[chat/memoria] non_indicizzato {"motivo":"${reason}"}`));
  for (const line of lines) assert.doesNotMatch(line, /Rossi|esempio|333|RSSMRA|1970|visita/);
  // Un nome proprio da solo, un ruolo, un'azienda: passano.
  await indexConversationMessage(CONV, WS, "Marco e il responsabile commerciale seguono i clienti più grandi della zona.", "user");
  assert.equal(prova.inserted.length, 1);
});

test("se la scrittura non riesce il messaggio resta nella conversazione e nel log non c'è il suo testo", async (t) => {
  const lines = recordLogs(t);
  reset({ insertFails: true });
  await indexConversationMessage(CONV, WS, "Il magazzino riceve la merce ogni mattina e prepara le spedizioni.", "user");
  assert.deepEqual(lines, ["Failed to index conversation message"]);
});

test("i frammenti di un documento «Solo Lateral Space» tornano solo a Lateral Space: per gli altri, e senza sapere chi chiede, restano fuori", async () => {
  const documentWhere = async (options: Parameters<typeof retrieveRelevantContext>[2]) => {
    reset({ storeState: prova.storeState });
    await retrieveRelevantContext("magazzino ordini", WS, options);
    assert.equal(prova.wheres.length, options?.includeConversations === false ? 1 : 2);
    return text(prova.wheres[0]);
  };
  assert.match(await documentWhere({ viewer: { isLateralSpace: false } }), LS_ONLY);
  assert.match(await documentWhere({}), LS_ONLY, "senza `viewer` si chiude");
  assert.match(await documentWhere({ includeConversations: false }), LS_ONLY);
  assert.doesNotMatch(await documentWhere({ viewer: { isLateralSpace: true } }), LS_ONLY);
  // La ricerca resta quella di prima: il workspace e le parole, sulla stessa espressione dell'indice.
  const where = await documentWhere({ viewer: { isLateralSpace: false } });
  assert.match(where, /"document_chunks"\."workspace_id" = \$1 AND to_tsvector\('italian', "document_chunks"\."content"\) @@ to_tsquery\('italian', \$2\)/);
  // La memoria della chat non ha documenti: il suo filtro non cambia.
  assert.doesNotMatch(text(prova.wheres[1]), /context_sources/);
  // Senza la 0038 nessun documento è «Solo Lateral Space»: la tabella non si nomina.
  prova.storeState = "assente";
  assert.doesNotMatch(await documentWhere({ viewer: { isLateralSpace: false } }), /context_sources/);
  prova.storeState = "pronto";
  // Una domanda senza parole non cerca niente.
  reset();
  assert.deepEqual(await retrieveRelevantContext("a è", WS, {}), []);
  assert.deepEqual(prova.wheres, []);
});

test("se la sonda della 0038 non risponde, chi non è di Lateral Space non riceve frammenti di documenti: si chiude, non si apre", async () => {
  // La sonda non risponde (un errore del database, o il self-heal che lancia a freddo): non si sa quali documenti sono interni.
  reset({ storeState: "sconosciuto" });
  assert.deepEqual(await retrieveRelevantContext("magazzino ordini", WS, { viewer: { isLateralSpace: false } }), []);
  assert.equal(prova.wheres.length, 1, "la ricerca nei documenti non parte");
  assert.doesNotMatch(text(prova.wheres[0]), /document_chunks/, "resta solo la memoria della chat");
  reset({ storeState: "sconosciuto" });
  await retrieveRelevantContext("magazzino ordini", WS, {});
  assert.equal(prova.wheres.length, 1, "senza `viewer`, lo stesso");
  // Lateral Space vede tutti i documenti: per lui la sonda non conta.
  reset({ storeState: "sconosciuto" });
  await retrieveRelevantContext("magazzino ordini", WS, { viewer: { isLateralSpace: true } });
  assert.equal(prova.wheres.length, 2);
  assert.match(text(prova.wheres[0]), /document_chunks/);
});
