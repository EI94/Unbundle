import test from "node:test";
import assert from "node:assert/strict";
import { userContextFrom } from "../lateral-space.ts";
import {
  SUBPROCESSORS,
  SUBPROCESSORS_POWERS_TEXT,
  SUBPROCESSORS_VERSION,
  canDeclareSubprocessors,
  checkSubprocessorDeclaration,
  romeDateTimeLabel,
  subprocessorsDeclaredLine,
  subprocessorsLsNotice,
  subprocessorsRecordText,
  subprocessorsStatement,
  subprocessorsWaitingLine,
} from "./subprocessors.ts";

const LS = ["ls.test"];
const verified = new Date("2026-10-01T08:00:00Z");
const client = userContextFrom({ id: "c", email: "builder@cliente.test", emailVerified: verified }, LS);
const unverifiedClient = userContextFrom({ id: "u", email: "builder@cliente.test", emailVerified: null }, LS);
const lateral = userContextFrom({ id: "l", email: "lead@ls.test", emailVerified: verified }, LS);
const lateralUnverified = userContextFrom({ id: "x", email: "lead@ls.test", emailVerified: null }, LS);

test("the list has version 2026-10 and the five sub-processors, in plain Italian", () => {
  assert.equal(SUBPROCESSORS_VERSION, "2026-10");
  assert.deepEqual(
    SUBPROCESSORS.map((s) => s.nome),
    ["Vercel", "Neon", "Google Firebase", "Anthropic", "Resend"],
  );
  assert.deepEqual(SUBPROCESSORS[0], { nome: "Vercel", cosaFa: "hosting dell'applicazione, funzioni e archivio dei file", doveStannoIDati: "UE (Francoforte)" });
  assert.deepEqual(SUBPROCESSORS[1], { nome: "Neon", cosaFa: "database", doveStannoIDati: "UE (Francoforte)" });
  for (const s of SUBPROCESSORS.slice(2)) assert.equal(s.doveStannoIDati, "fuori UE, con le garanzie dell'art. 46 GDPR", s.nome);
  assert.equal(SUBPROCESSORS[2].cosaFa, "accesso degli utenti (login)");
  assert.equal(SUBPROCESSORS[3].cosaFa, "analisi con l'AI di testi e documenti");
  assert.equal(SUBPROCESSORS[4].cosaFa, "invio delle email di notifica, quando attivo");
  assert.ok(Object.isFrozen(SUBPROCESSORS));
});

test("the statement is the agreed text with the company name", () => {
  assert.equal(
    subprocessorsStatement("Cliente Esempio"),
    "Per conto di Cliente Esempio, titolare del trattamento, autorizzo Lateral Space a ricorrere ai sub-responsabili elencati, " +
      "ai sensi dell'art. 28, paragrafo 2, del GDPR. Lateral Space impone loro gli stessi obblighi di protezione dei dati del nostro accordo " +
      "(art. 28, paragrafo 4) e ci informa prima di aggiungerne o sostituirne uno, così possiamo opporci.",
  );
  assert.match(subprocessorsStatement("  "), /^Per conto di la società,/);
  assert.equal(SUBPROCESSORS_POWERS_TEXT, "Ho i poteri per dare questa autorizzazione per la mia società.");
});

test("the stored text holds the statement, the list of this version and the checkbox sentence", () => {
  const text = subprocessorsRecordText("Cliente Esempio");
  assert.ok(text.startsWith(`${subprocessorsStatement("Cliente Esempio")}\n`));
  assert.ok(text.includes(`Sub-responsabili (lista ${SUBPROCESSORS_VERSION}):`));
  assert.ok(text.includes("- Vercel: hosting dell'applicazione, funzioni e archivio dei file. Dati: UE (Francoforte)."));
  assert.ok(text.includes("- Resend: invio delle email di notifica, quando attivo. Dati: fuori UE, con le garanzie dell'art. 46 GDPR."));
  assert.equal(text.split("\n").filter((line) => line.startsWith("- ")).length, SUBPROCESSORS.length);
  assert.ok(text.endsWith(SUBPROCESSORS_POWERS_TEXT));
});

test("only a verified client person with a manager role can declare", () => {
  for (const role of ["exec_sponsor", "transformation_lead", "function_lead"]) {
    assert.equal(canDeclareSubprocessors(client, role, LS), true, role);
    assert.equal(canDeclareSubprocessors(lateral, role, LS), false, `Lateral Space ${role}`);
    assert.equal(canDeclareSubprocessors(lateralUnverified, role, LS), false, `unverified Lateral Space domain ${role}`);
    assert.equal(canDeclareSubprocessors(unverifiedClient, role, LS), false, `unverified client ${role}`);
  }
  for (const role of ["analyst", "contributor", "learner", "", "ls_lead"]) {
    assert.equal(canDeclareSubprocessors(client, role, LS), false, role);
  }
  assert.equal(canDeclareSubprocessors(null, "function_lead", LS), false);
  assert.equal(canDeclareSubprocessors(client, null, LS), false);
});

test("without the Lateral Space domains nobody can declare, as the rest of the section is read-only", () => {
  const lsAsClient = userContextFrom({ id: "l", email: "lead@ls.test", emailVerified: verified }, []);
  for (const role of ["exec_sponsor", "transformation_lead", "function_lead"]) {
    assert.equal(canDeclareSubprocessors(lsAsClient, role, []), false, `Lateral Space ${role}`);
    assert.equal(canDeclareSubprocessors(client, role, []), false, `client ${role}`);
  }
  const r = checkSubprocessorDeclaration({ user: lsAsClient, workspaceRole: "exec_sponsor", lsDomains: [], listVersion: SUBPROCESSORS_VERSION, confirmed: true });
  assert.equal(r.ok ? "ok" : r.code, "non_autorizzato");
});

test("the server check refuses the wrong person, an old list and an unticked box, in this order", () => {
  const base = { user: client, workspaceRole: "function_lead", lsDomains: LS, listVersion: SUBPROCESSORS_VERSION, confirmed: true };
  assert.deepEqual(checkSubprocessorDeclaration(base), { ok: true, value: null });
  const code = (over: Partial<typeof base> & Record<string, unknown>) => {
    const r = checkSubprocessorDeclaration({ ...base, ...over } as typeof base);
    return r.ok ? "ok" : r.code;
  };
  assert.equal(code({ user: lateral }), "non_autorizzato");
  assert.equal(code({ workspaceRole: "learner" }), "non_autorizzato");
  assert.equal(code({ workspaceRole: "analyst", listVersion: "2025-01" }), "non_autorizzato");
  assert.equal(code({ listVersion: "2025-01" }), "versione_superata");
  assert.equal(code({ listVersion: undefined as unknown as string }), "versione_superata");
  assert.equal(code({ confirmed: false }), "conferma_mancante");
  assert.equal(code({ confirmed: "true" as unknown as boolean }), "conferma_mancante");
});

test("declared and waiting lines, with the date and time of Rome", () => {
  // 21 October 2026, 12:05 UTC = 14:05 in Rome (summer time).
  assert.equal(romeDateTimeLabel(new Date("2026-10-21T12:05:00Z")), "21/10/2026 alle 14:05");
  // 2 December 2026, 23:30 UTC = 3 December, 00:30 in Rome (winter time).
  assert.equal(romeDateTimeLabel(new Date("2026-12-02T23:30:00Z")), "03/12/2026 alle 00:30");
  assert.equal(
    subprocessorsDeclaredLine({ declaredByName: "Giulia Rossi", declaredAt: new Date("2026-10-21T12:05:00Z"), listVersion: "2026-10" }),
    "Autorizzati da Giulia Rossi il 21/10/2026 alle 14:05 (lista 2026-10).",
  );
  assert.equal(
    subprocessorsWaitingLine("Cliente Esempio"),
    "La conferma la dà un responsabile di Cliente Esempio (ruolo Responsabile di funzione o superiore).",
  );
  assert.equal(
    subprocessorsLsNotice("Cliente Esempio"),
    "Sub-responsabili non ancora autorizzati da Cliente Esempio: chiedi la conferma in Impostazioni.",
  );
});
