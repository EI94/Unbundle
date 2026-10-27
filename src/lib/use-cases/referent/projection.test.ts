import test from "node:test";
import assert from "node:assert/strict";
import { romeLocalToUtc } from "../../uc/calendar.ts";
import { REFERENT_PRIVACY_NOTICE } from "./labels.ts";
import {
  PANEL_VIEW_KEYS,
  PUBLIC_VIEW_KEYS,
  keyPaths,
  maskEmail,
  needReferentLine,
  requestLines,
  toPublicView,
  type LatestAskForNeed,
  type PublicRows,
  type RequestRowForView,
} from "./view.ts";

// Proiezioni: la pagina pubblica e il pannello dei revisori mostrano solo i campi del contratto
// (SPEC §8, §9.1). Dati inventati, con «segreti» seminati che non devono mai uscire.
const at = (d: string, h = 10) => romeLocalToUtc(d, h);
const NOW = at("2026-11-04", 12);
const TODAY = "2026-11-04";
const SECRETS = ["DETTAGLIO-RISERVATO", "Responsabile interno", "proponente@topjet.it", "punteggio-87", "valore-12000"];

function rows(over: Partial<PublicRows["request"]> = {}): PublicRows {
  // Righe come le leggerebbe il database, con colonne in più che la vista non deve usare.
  const dbNeed = { detail: SECRETS[0], ownerLabel: SECRETS[1], proposedBy: SECRETS[2], score: SECRETS[3], value: SECRETS[4] };
  return {
    request: {
      status: "inviata",
      expiresAt: at("2026-11-26"),
      privacyAcceptedAt: at("2026-11-02"),
      privacyNoticeVersion: REFERENT_PRIVACY_NOTICE.version,
      requesterName: "Giulia Neri",
      message: "Grazie!",
      ...over,
    },
    company: "TopJet",
    useCase: { code: "TJ-0004", title: "Fatture fornitori", ...({ proposedBy: SECRETS[2], intake: { secret: SECRETS[4] } } as object) } as PublicRows["useCase"],
    items: [
      {
        needId: "n1",
        position: 2,
        question: "Quante fatture al giorno?",
        state: "aperta",
        open: true,
        visible: true,
        draft: { body: "circa 20", dontKnow: false, updatedAt: at("2026-11-03") },
        answer: null,
        files: [
          { id: "f1", fileName: "esempio.csv", sizeBytes: 120, scanStatus: "pulito", message: null, personalWarning: true, warningConfirmed: false, submitted: false },
          { id: "f2", fileName: "rifiutato.txt", sizeBytes: 10, scanStatus: "rifiutato", message: "no", personalWarning: false, warningConfirmed: false, submitted: false },
        ],
        ...(dbNeed as object),
      },
      { needId: "n2", position: 1, question: "Quali programmi?", state: "risposta", open: false, visible: true, draft: null, answer: { body: "Excel", dontKnow: false, submittedAt: at("2026-11-03") }, files: [] },
      { needId: "n3", position: 3, question: "Ritirata", state: "aperta", open: false, visible: true, draft: null, answer: null, files: [] },
      { needId: "n4", position: 4, question: "Scollegata", state: "risposta", open: false, visible: false, draft: null, answer: null, files: [] },
    ],
    privacyContact: "privacy@example.test",
    clientMode: false,
  };
}

test("vista pubblica: solo le chiavi del contratto, nessun dato seminato", () => {
  const view = toPublicView(rows());
  const keys = keyPaths(view);
  assert.deepEqual(keys.filter((k) => !PUBLIC_VIEW_KEYS.includes(k)), []);
  const json = JSON.stringify(view);
  for (const secret of SECRETS) assert.ok(!json.includes(secret), secret);
  // In ordine di posizione; ritirate e scollegate non si vedono; i rifiutati non si vedono.
  assert.deepEqual(view.questions.map((q) => q.needId), ["n2", "n1"]);
  assert.deepEqual(view.questions[1].files.map((f) => f.id), ["f1"]);
  assert.equal(view.questions[1].files[0].needsConfirmation, true);
  assert.equal(view.questions[0].state, "inviata");
  assert.deepEqual(view.questions[0].answer, { text: "Excel", dontKnow: false, submittedAt: at("2026-11-03").toISOString() });
  assert.equal(view.state, "aperta");
  assert.equal(view.expiresOn, "2026-11-26");
  assert.deepEqual(view.privacy, { accepted: true, version: REFERENT_PRIVACY_NOTICE.version, contact: "privacy@example.test" });
});

test("vista pubblica: un'informativa vecchia si mostra di nuovo; senza domande aperte «completata» o «vuota»", () => {
  assert.equal(toPublicView(rows({ privacyNoticeVersion: "ucq-2025-01-1" })).privacy.accepted, false);
  const done = rows({ status: "completata" });
  done.items = done.items.filter((i) => !i.open);
  assert.equal(toPublicView(done).state, "completata");
  const empty = rows();
  empty.items = [empty.items[2]];
  assert.equal(toPublicView(empty).state, "vuota");
});

function requestRecord(privacyAccepted: boolean) {
  // Una riga come dal database, con i campi dell'informativa: le funzioni non devono guardarli.
  return {
    status: "inviata" as const,
    createdAt: at("2026-10-27"),
    sentAt: at("2026-10-27"),
    expiresAt: at("2026-11-26"),
    lastEmailAt: at("2026-10-30"),
    lastReminderAt: at("2026-10-30"),
    reminderCount: 1,
    completedAt: null,
    expiredAt: null,
    revokedAt: null,
    openItems: 3,
    privacy_accepted_at: privacyAccepted ? at("2026-10-28") : null,
    privacy_notice_version: privacyAccepted ? REFERENT_PRIVACY_NOTICE.version : null,
  };
}

test("le righe di una richiesta non dipendono dalla lettura dell'informativa, e non contano tempi", () => {
  const read = requestLines(requestRecord(true) as RequestRowForView, TODAY, NOW);
  const unread = requestLines(requestRecord(false) as RequestRowForView, TODAY, NOW);
  assert.deepEqual(read, unread);
  assert.ok(read.length >= 2, read.join(" | "));
  for (const line of read) {
    assert.doesNotMatch(line.replace(/\d{2}\/\d{2}(\/\d{4})?/g, ""), /\d/, line);
    assert.doesNotMatch(line, /ritard/i, line);
  }
  const ask = (accepted: boolean) =>
    ({
      contactName: "Mario Rossi",
      useCaseId: "uc1",
      useCaseCode: "TJ-0004",
      status: "inviata",
      createdAt: at("2026-10-27"),
      sentAt: at("2026-10-27"),
      expiresAt: at("2026-11-26"),
      expiredAt: null,
      revokedAt: null,
      reminderCount: 1,
      lastReminderAt: at("2026-10-30"),
      itemState: "aperta",
      answeredAt: null,
      privacy_accepted_at: accepted ? at("2026-10-28") : null,
    }) as LatestAskForNeed;
  assert.equal(needReferentLine(ask(true), TODAY, "uc1"), needReferentLine(ask(false), TODAY, "uc1"));
  const line = needReferentLine(ask(true), TODAY, "uc1") ?? "";
  assert.ok(line.includes("Mario Rossi") && line.includes("27/10"), line);
  assert.ok((needReferentLine(ask(true), TODAY, "uc2") ?? "").includes("TJ-0004"));
  assert.equal(needReferentLine(null, TODAY, "uc1"), null);
});

test("pannello: l'unica email intera è quella di chi guarda; le altre sono mascherate", () => {
  const emailKeys = PANEL_VIEW_KEYS.filter((k) => /email/i.test(k));
  assert.deepEqual(emailKeys, ["contacts[].emailMasked", "requests[].contact.emailMasked", "requests[].email", "requests[].email.state", "requests[].email.label", "requests[].actions.correctEmail", "requester.email"]);
  assert.equal(maskEmail(" Mario.Rossi@TopJet.it "), "m•••@topjet.it");
  assert.equal(maskEmail(null), null);
  assert.equal(maskEmail("senza-chiocciola"), null);
  assert.ok(!PANEL_VIEW_KEYS.some((k) => /privacy|answered_?at|delay|ritardo|count/i.test(k)));
});
