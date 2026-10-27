import test from "node:test";
import assert from "node:assert/strict";
import { REFERENT_PRIVACY_NOTICE } from "./labels.ts";
import { NEED_TRANSITIONS, itemIsOpen, needStatusAfter, nextRequestStatus, privacyAccepted, reviewerStatus, type NeedEvent, type RequestEvent } from "./state.ts";
import type { NeedStatus } from "../needs.ts";

// Gli stati di «Chiedi al referente» (SPEC §3.3–§3.5).
const STATUSES = ["inviata", "completata", "scaduta", "revocata"] as const;
const REQUISITO: NeedStatus[] = ["da_chiedere", "chiesta", "in_verifica", "mancante", "parziale", "bloccata", "validata", "non_applicabile"];

test("richiesta: inviata → completata, scaduta, revocata; completata → revocata; il resto non torna indietro", () => {
  const table: Record<RequestEvent, Record<(typeof STATUSES)[number], string | null>> = {
    submit_last: { inviata: "completata", completata: null, scaduta: null, revocata: null },
    all_withdrawn: { inviata: "completata", completata: null, scaduta: null, revocata: null },
    revoke: { inviata: "revocata", completata: "revocata", scaduta: null, revocata: null },
    expire: { inviata: "scaduta", completata: null, scaduta: null, revocata: null },
  };
  for (const [event, row] of Object.entries(table) as Array<[RequestEvent, Record<string, string | null>]>) {
    for (const from of STATUSES) assert.equal(nextRequestStatus(from, event), row[from], `${from} + ${event}`);
  }
});

test("per i revisori una richiesta inviata oltre la scadenza è già scaduta", () => {
  const now = new Date("2026-11-27T10:00:00Z");
  assert.equal(reviewerStatus({ status: "inviata", expiresAt: new Date("2026-11-27T09:59:59Z") }, now), "scaduta");
  assert.equal(reviewerStatus({ status: "inviata", expiresAt: now }, now), "scaduta");
  assert.equal(reviewerStatus({ status: "inviata", expiresAt: new Date("2026-11-27T10:00:01Z") }, now), "inviata");
  assert.equal(reviewerStatus({ status: "completata", expiresAt: new Date("2026-01-01T00:00:00Z") }, now), "completata");
});

test("esigenze: la tabella di §3.5 (Parte 2: la scadenza e la sostituzione non cambiano niente)", () => {
  const expected: Record<NeedEvent, Partial<Record<NeedStatus, NeedStatus>>> = {
    send: { da_chiedere: "chiesta", mancante: "chiesta", parziale: "chiesta" },
    referent_answer: { chiesta: "in_verifica" },
    referent_dont_know: { chiesta: "mancante" },
    revoke_open: { chiesta: "da_chiedere" },
    expire_open: {},
    revoke_replaced: {},
    reviewer_answer: { da_chiedere: "in_verifica", chiesta: "in_verifica", mancante: "in_verifica", parziale: "in_verifica" },
    reviewer_answer_validated: { da_chiedere: "validata", chiesta: "validata", mancante: "validata", parziale: "validata", in_verifica: "validata" },
  };
  assert.deepEqual(Object.keys(NEED_TRANSITIONS).sort(), Object.keys(expected).sort());
  for (const [event, moves] of Object.entries(expected) as Array<[NeedEvent, Partial<Record<NeedStatus, NeedStatus>>]>) {
    for (const from of REQUISITO) assert.equal(needStatusAfter(event, from), moves[from] ?? null, `${event} da ${from}`);
  }
});

test("una domanda è aperta solo se aperta, chiesta, non archiviata e collegata", () => {
  const open = { state: "aperta" as const, needStatus: "chiesta" as NeedStatus, needArchived: false, linked: true };
  assert.equal(itemIsOpen(open), true);
  assert.equal(itemIsOpen({ ...open, state: "risposta" }), false);
  assert.equal(itemIsOpen({ ...open, state: "non_so" }), false);
  assert.equal(itemIsOpen({ ...open, needStatus: "da_chiedere" }), false);
  assert.equal(itemIsOpen({ ...open, needArchived: true }), false);
  assert.equal(itemIsOpen({ ...open, linked: false }), false);
});

test("l'informativa vale per la versione di adesso", () => {
  const at = new Date("2026-10-27T09:00:00Z");
  assert.equal(privacyAccepted({ privacyAcceptedAt: at, privacyNoticeVersion: REFERENT_PRIVACY_NOTICE.version }), true);
  assert.equal(privacyAccepted({ privacyAcceptedAt: at, privacyNoticeVersion: "ucq-2025-01-1" }), false);
  assert.equal(privacyAccepted({ privacyAcceptedAt: null, privacyNoticeVersion: null }), false);
});
