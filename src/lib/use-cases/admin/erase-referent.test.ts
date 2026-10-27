import test from "node:test";
import assert from "node:assert/strict";
import {
  ERASE_REFERENT_BLOB_NOTE,
  ERASE_REFERENT_DOSSIER_NOTE,
  ERASE_REFERENT_OPTIONS,
  eraseReferentPlan,
  eraseReferentReads,
} from "./erase-referent.ts";
import { ADMIN_COMMANDS, parseAdminOptions } from "./cli.ts";

// `use-case-admin erase-referent` (SPEC §3.10). Id inventati.
const WS = "3f2a9c1e-0000-4000-8000-0000000000a1";
const CONTACT = "3f2a9c1e-0000-4000-8000-0000000000c1";
const UC = "3f2a9c1e-0000-4000-8000-0000000000b1";

test("erase-referent è un comando, con --contact", () => {
  assert.ok((ADMIN_COMMANDS as readonly string[]).includes("erase-referent"));
  const parsed = parseAdminOptions(["--workspace", WS, "--contact", CONTACT], ERASE_REFERENT_OPTIONS);
  assert.ok(parsed.ok);
  if (parsed.ok) assert.equal(parsed.value.values.get("contact"), CONTACT);
  assert.equal(parseAdminOptions(["--workspace", WS, "--persona", CONTACT], ERASE_REFERENT_OPTIONS).ok, false);
});

test("erase-referent: id che non sono uuid si rifiutano prima di ogni lettura", () => {
  assert.throws(() => eraseReferentReads(WS, "mario@example.com"));
  assert.throws(() => eraseReferentReads("non-un-id", CONTACT));
  assert.throws(() => eraseReferentPlan(WS, "x", { hubOnly: true, anonymized: false, useCaseIds: [], requests: 1 }));
});

test("erase-referent: le letture filtrano su workspace e referente, senza dati della persona", () => {
  const reads = eraseReferentReads(WS, CONTACT);
  assert.match(reads.contact.text, /FROM uc_contacts WHERE id = \$1::uuid AND workspace_id = \$2::uuid/);
  assert.deepEqual(reads.contact.params, [CONTACT, WS]);
  assert.doesNotMatch(reads.contact.text, /email|display_name/);
  assert.match(reads.requests.text, /r\.workspace_id = \$1::uuid AND r\.contact_id = \$2::uuid/);
  assert.match(reads.useCases.text, /SELECT DISTINCT r\.use_case_id/);
});

test("erase-referent: statement in ordine — revoca, link, coda, risposte, file, richieste, Storia, sincronizzazione", () => {
  const plan = eraseReferentPlan(WS, CONTACT, { hubOnly: false, anonymized: false, useCaseIds: [UC], requests: 2 });
  const texts = plan.statements.map((s) => s.text);
  const at = (re: RegExp) => texts.findIndex((t) => re.test(t));
  const order = [
    at(/revoked_reason/),
    at(/UPDATE use_case_referent_tokens t SET revoked_at = now\(\)/),
    at(/UPDATE use_case_referent_email_items it SET state = 'tolta', drop_reason = 'cancellazione'\nFROM use_case_referent_emails e/),
    at(/UPDATE use_case_referent_emails SET status = 'annullata', cancel_reason = 'cancellazione'/),
    at(/UPDATE use_case_need_answers a SET body = NULL/),
    at(/UPDATE use_case_need_files f SET deleted_at = coalesce/),
    at(/UPDATE use_case_referent_requests r SET message = NULL, purged_at/),
    at(/'dati_cancellati'/),
    at(/pg_advisory_xact_lock\(hashtext\('use-case-info:'/),
  ];
  assert.ok(order.every((i) => i >= 0), JSON.stringify(order));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  // Il referente è anche in un dossier: la riga resta, e il piano lo dice.
  assert.equal(plan.anonymizeContact, false);
  assert.ok(!texts.some((t) => /anonymized_at = now\(\)/.test(t) && /UPDATE uc_contacts/.test(t)));
  assert.deepEqual(plan.report, { useCase: 1, richieste: 2, anonimizza: false, note: [ERASE_REFERENT_BLOB_NOTE, ERASE_REFERENT_DOSSIER_NOTE] });
  // L'attore è il sistema: nessuna persona.
  assert.ok(texts.some((t) => /'dati_cancellati'/.test(t)));
  const history = plan.statements.find((s) => /'dati_cancellati'/.test(s.text));
  assert.ok(history?.params.includes("sistema") && history.params.includes("altro"));
});

test("erase-referent: solo dell'hub e non ancora anonimizzato → le guardie, poi l'anonimizzazione", () => {
  const plan = eraseReferentPlan(WS, CONTACT, { hubOnly: true, anonymized: false, useCaseIds: [], requests: 1 });
  assert.equal(plan.anonymizeContact, true);
  const texts = plan.statements.map((s) => s.text);
  const guard = texts.findIndex((t) => /'referente_in_dossier'/.test(t));
  const anonymize = texts.findIndex((t) => /UPDATE uc_contacts/.test(t));
  assert.ok(guard >= 0 && anonymize > guard);
  assert.deepEqual(plan.report.note, [ERASE_REFERENT_BLOB_NOTE]);
  // Una seconda cancellazione non riprova ad anonimizzare.
  assert.equal(eraseReferentPlan(WS, CONTACT, { hubOnly: true, anonymized: true, useCaseIds: [], requests: 1 }).anonymizeContact, false);
});
