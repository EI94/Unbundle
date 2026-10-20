import test from "node:test";
import assert from "node:assert/strict";
import type { UcExecutor, UcRow } from "../db/uc-executor.ts";
import type { UcCommandContext } from "../db/queries/uc-cases.ts";
import {
  assignInChunks,
  assignRoleQuestions,
  dossierCodes,
  peopleContactsClientSql,
  peopleContactsLsSql,
  personContactFromRow,
  reassignContactQuestions,
  updateCaseSettings,
} from "../db/queries/uc-people-view.ts";
import type { AssignmentResult } from "../db/queries/uc-requests.ts";
import type { UcStatement } from "./sql/statement.ts";
import { fail, ok } from "./types.ts";
import type { CaseRole, CaseStatus } from "./vocab.ts";

// Unit tests for src/lib/db/queries/uc-people-view.ts with a fake executor: the
// client reading of Persone (art. 15.4), the codes of Impostazioni › Il caso
// and the refusals of the commands before any write. The same reads and
// commands run against Postgres in requests.integration.test.ts (harness only).

const WS = "11111111-1111-4111-8111-111111111111";
const CASE = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";
const CONTACT = "44444444-4444-4444-8444-444444444444";

function ctx(roles: CaseRole[]): UcCommandContext {
  return {
    workspaceId: WS,
    caseId: CASE,
    actor: { type: "utente", userId: USER, roles },
    user: { userId: USER, email: "lead@ls.test", emailVerified: true, emailDomain: "ls.test", isLateralSpace: roles.some((r) => r.startsWith("ls_")) },
    lsDomains: ["ls.test"],
  } as UcCommandContext;
}

function settingsRow(over: Record<string, unknown> = {}): UcRow {
  return {
    title: "Smistamento richieste",
    one_liner: "Instrada ogni richiesta alla persona giusta.",
    perimeter_label: null,
    levers: JSON.stringify(["tempo"]),
    code: "XX-0012",
    status: "raccolta" satisfies CaseStatus,
    template_version: "1.0.0",
    template_name: "Esempio",
    use_case_id: null,
    use_case_code: null,
    ...over,
  };
}

/** Le letture rispondono con `reads` in ordine; ogni altra istruzione «riesce». */
function fakeExecutor(reads: UcRow[][]): UcExecutor & { calls: UcStatement[][] } {
  const calls: UcStatement[][] = [];
  const queue = [...reads];
  return {
    calls,
    async batch(statements) {
      calls.push([...statements]);
      if (statements.every((s) => /^\s*SELECT/i.test(s.text))) return statements.map(() => queue.shift() ?? []);
      return statements.map((s) => (/RETURNING id/.test(s.text) ? [{ id: CASE }] : []));
    },
  };
}

test("the client reading of Persone counts nothing per person and reads no contact details (art. 15.4)", () => {
  const client = peopleContactsClientSql(WS, CASE).text;
  assert.doesNotMatch(client, /count\(/i);
  assert.doesNotMatch(client, /phone/);
  assert.doesNotMatch(client, /ct\.email,|ct\.email\s+AS/);
  assert.doesNotMatch(client, /ORDER BY[^]*(assigned|open|unsent|count)/i);
  const ls = peopleContactsLsSql(WS, CASE).text;
  assert.match(ls, /count\(\*\)/);
  assert.match(ls, /ORDER BY lower\(ct\.display_name\), ct\.id$/, "even Lateral Space reads people by name, never by open questions");
  const row = { id: CONTACT, display_name: "Anna Bianchi", role_label: null, template_role_key: null, email: "anna@cliente.test", phone_e164: "+393331234567", is_active: true, anonymized: false, has_email: true, involved: true, assigned: 8, open_items: 3, unsent: 1 };
  const asClient = personContactFromRow(row, "cliente");
  assert.deepEqual([asClient.email, asClient.phone, asClient.counts], [null, null, null]);
  assert.equal(asClient.hasEmail, true);
  const asLs = personContactFromRow(row, "lateral_space");
  assert.deepEqual(asLs.counts, { assigned: 8, open: 3, unsent: 1 });
  assert.equal(asLs.email, "anna@cliente.test");
});

test("the dossier shows the use case code; the old one only when it differs (§2.1)", () => {
  assert.deepEqual(dossierCodes("XX-0012", "XX-0012"), { displayCode: "XX-0012", previousCode: null });
  assert.deepEqual(dossierCodes("SR-01", "XX-0012"), { displayCode: "XX-0012", previousCode: "SR-01" });
  assert.deepEqual(dossierCodes("SR-01", null), { displayCode: "SR-01", previousCode: null });
  assert.deepEqual(dossierCodes("SR-01", "  "), { displayCode: "SR-01", previousCode: null });
});

test("case settings: only the Lateral Space lead, never the code, field names only in the audit", async () => {
  const refused = fakeExecutor([]);
  const analyst = await updateCaseSettings(refused, ctx(["ls_analista"]), { title: "Nuovo nome" });
  assert.equal(analyst.ok ? null : analyst.code, "attore_non_ammesso");
  assert.equal(refused.calls.length, 0, "no read before the permission check");

  const strict = await updateCaseSettings(fakeExecutor([]), ctx(["ls_lead"]), { code: "XX-9999" });
  assert.equal(strict.ok ? null : strict.code, "dati_non_validi", "the code is not a setting");
  const bad = await updateCaseSettings(fakeExecutor([]), ctx(["ls_lead"]), { levers: ["volume"] });
  assert.equal(bad.ok ? null : bad.code, "dati_non_validi");

  const same = fakeExecutor([[settingsRow()]]);
  const unchanged = await updateCaseSettings(same, ctx(["ls_lead"]), { title: "Smistamento richieste", levers: ["tempo"] });
  assert.ok(unchanged.ok && unchanged.value.fields.length === 0);
  assert.equal(same.calls.length, 1, "nothing to write");

  const closed = await updateCaseSettings(fakeExecutor([[settingsRow({ status: "chiuso" })]]), ctx(["ls_lead"]), { title: "Altro nome" });
  assert.equal(closed.ok ? null : closed.code, "caso_chiuso");

  const exec = fakeExecutor([[settingsRow()]]);
  const done = await updateCaseSettings(exec, ctx(["ls_lead"]), { title: "Smistamento delle richieste", perimeterLabel: "Clienti business", levers: ["rischio", "tempo"] });
  assert.ok(done.ok, done.ok ? "" : done.message);
  assert.deepEqual(done.value.fields, ["nome", "perimetro", "leve"]);
  const write = exec.calls[1];
  assert.equal(write.length, 2);
  assert.match(write[0].text, /UPDATE uc_cases SET title = /);
  assert.match(write[0].text, /status <> 'chiuso'/);
  assert.doesNotMatch(write[0].text, /\bcode\s*=/, "the code never changes");
  assert.ok(write[0].params.includes(JSON.stringify(["tempo", "rischio"])) || write[0].params.some((p) => JSON.stringify(p) === JSON.stringify(["tempo", "rischio"])), "levers in the fixed order");
  const event = JSON.stringify(write[1].params);
  assert.match(event, /caso\.descrizione_modificata/);
  const payload = write[1].params.find((p) => typeof p === "string" && p.startsWith("{"));
  assert.deepEqual(JSON.parse(String(payload)), { blocks: ["nome", "perimetro", "leve"] });
  assert.doesNotMatch(event, /Smistamento|Clienti business/, "no texts in the audit");
});

test("assignments from Persone: the client lead never overwrites, nobody else assigns", async () => {
  const owner = await assignRoleQuestions(fakeExecutor([]), ctx(["owner_cliente"]), { roleKey: "sistemi", contactId: CONTACT, includeAssigned: true });
  assert.equal(owner.ok ? null : owner.code, "attore_non_ammesso");
  const observer = await assignRoleQuestions(fakeExecutor([]), ctx(["osservatore"]), { roleKey: "sistemi", contactId: CONTACT });
  assert.equal(observer.ok ? null : observer.code, "attore_non_ammesso");
  const empty = await assignRoleQuestions(fakeExecutor([[]]), ctx(["owner_cliente"]), { roleKey: "sistemi", contactId: CONTACT });
  assert.equal(empty.ok ? null : empty.code, "nessuna_voce");
  const bad = await assignRoleQuestions(fakeExecutor([]), ctx(["ls_lead"]), { roleKey: "Sistemi!", contactId: CONTACT });
  assert.equal(bad.ok ? null : bad.code, "dati_non_validi");
  const self = await reassignContactQuestions(fakeExecutor([]), ctx(["owner_cliente"]), { fromContactId: CONTACT, toContactId: CONTACT });
  assert.equal(self.ok ? null : self.code, "dati_non_validi");
  const analyst = await reassignContactQuestions(fakeExecutor([]), ctx(["ls_analista"]), { fromContactId: CONTACT, toContactId: USER });
  assert.equal(analyst.ok ? null : analyst.code, "attore_non_ammesso");
});

test("bulk assignment in chunks: a stop halfway is reported with what was done, never as a plain success", async () => {
  const ids = Array.from({ length: 4500 }, (_, i) => `v${i}`);
  const done = (n: number): AssignmentResult => ({ assigned: n, unchanged: 0, skipped: [], skippedTotal: 0, roleMismatch: 0 });
  const sizes: number[] = [];
  const all = await assignInChunks(ids, async (chunk) => (sizes.push(chunk.length), ok(done(chunk.length))));
  assert.deepEqual(sizes, [2000, 2000, 500]);
  assert.ok(all.ok);
  assert.deepEqual([all.value.assigned, all.value.interrupted, all.value.truncated], [4500, null, false]);

  let calls = 0;
  const halfway = await assignInChunks(ids, async (chunk) => (++calls === 2 ? fail("conflitto", "Qualcuno ha appena cambiato queste domande.") : ok(done(chunk.length))), { truncated: true });
  assert.ok(halfway.ok, "the first chunk is written: the page must refresh");
  assert.deepEqual([halfway.value.assigned, halfway.value.interrupted, halfway.value.truncated], [2000, "Qualcuno ha appena cambiato queste domande.", true]);
  assert.equal(calls, 2, "it stops at the first error");

  const first = await assignInChunks(ids, async () => fail("contatto_non_trovato", "Referente non trovato."));
  assert.equal(first.ok ? null : first.code, "contatto_non_trovato", "nothing done: the error as it is");
});
