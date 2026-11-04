import test from "node:test";
import assert from "node:assert/strict";
import { findHubForbidden } from "../copy-guard.ts";
import { INFO_PROGRESS_TEXT } from "../info-progress.ts";
import { USE_CASE_NOTICE_TEXT } from "../notices.ts";
import { BELL_TEXT } from "../../notifications/bell.ts";
import { renderReadyAlert, renderSuppliersAlert } from "../case-alerts/email.ts";
import { renderRequesterAlert } from "./alerts.ts";
import { renderReferentEmail } from "./email.ts";
import { HISTORY_ACTOR_TEXT, REFERENT_HISTORY_TEXT } from "./history.ts";
import {
  REFERENT_CHECK_TEXT,
  REFERENT_ERROR_MESSAGES,
  REFERENT_IMPACT_TEXT,
  REFERENT_PRIVACY_NOTICE,
  REFERENT_PUBLIC_TEXT,
  REFERENT_REQUEST_WORD,
  REFERENT_UI_TEXT,
  privacyNoticeTexts,
} from "./labels.ts";
import { PREPARED_QUESTIONS } from "./prepare.ts";

// I testi di «Chiedi al referente», della campanella e di «Raccolta informazioni» (SPEC §5, §7, §P2.10):
// nella dashboard «use case», mai «caso d'uso» né «wave»; (rilascio 5.1, decisione del titolare del
// 04/11/2026) fuori dalla dashboard, cioè la pagina pubblica `/rispondi` e le email, «caso d'uso» e mai
// «use case» (ambito `esterno` di copy-guard.ts). Niente parole tecniche per i clienti.
function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => strings(v, out));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => strings(v, out));
  return out;
}

const TECH = /\b(token|MCP|workflow)\b/i;
const LINK = `https://app.example.test/rispondi/ucq_${"A".repeat(32)}`;
const EXPIRES = new Date("2026-11-26T10:00:00Z");
const UC = { code: "TJ-0004", title: "Fatture fornitori" };
/** Gli indirizzi delle email (`…/use-cases/…`) non sono testo da leggere. */
const withoutUrls = (t: string) => t.replace(/https?:\/\/[^\s"<]+/g, "");

const emails = [
  renderReferentEmail({ template: "richiesta", company: "TopJet", useCase: UC, requesterName: "Giulia Neri", questions: 2, message: "Grazie", expiresAt: EXPIRES, link: LINK, replyToKnown: true }),
  renderReferentEmail({ template: "richiesta", kind: "referente", company: "TopJet", useCase: UC, requesterName: "Giulia Neri", questions: 2, message: null, expiresAt: EXPIRES, link: LINK, replyToKnown: true }),
  renderReferentEmail({
    template: "promemoria",
    company: "TopJet",
    entries: [
      { useCase: UC, requesterName: "Giulia Neri", kind: "ultimo", openQuestions: 2, newQuestions: 0, expiresAt: EXPIRES, link: LINK },
      { useCase: UC, requesterName: "Giulia Neri", kind: "nuove", openQuestions: 1, newQuestions: 1, expiresAt: EXPIRES, link: LINK },
    ],
    replyToKnown: true,
    replyName: "Giulia Neri",
  }),
  renderReferentEmail({ template: "promemoria", company: "TopJet", entries: [{ useCase: UC, requesterName: "Giulia Neri", kind: "primo", openQuestions: 1, newQuestions: 0, expiresAt: EXPIRES, link: LINK, checkPending: true }], replyToKnown: true, replyName: "Giulia Neri" }),
  renderReferentEmail({ template: "conferma", company: "TopJet", useCase: UC, requesterName: "Giulia Neri", submitted: 2, openQuestions: 1, expiresAt: EXPIRES }),
  renderRequesterAlert({
    company: "TopJet",
    entries: [{ useCase: UC, answers: 2, unknowns: 1, documents: 1, followUp: "scaduta", link: "https://app.example.test/dashboard/x/use-cases/y?capitolo=cosa-serve" }],
  }),
  renderReadyAlert({ company: "TopJet", entries: [{ useCase: UC, quarter: "2027-Q1", link: "https://app.example.test/dashboard/x/use-cases/y?capitolo=realizzazione" }] }),
  renderSuppliersAlert({ company: "TopJet", link: "https://app.example.test/dashboard/x/settings#sub-responsabili" }),
];
const emailTexts = emails.flatMap((m) => [m.subject, withoutUrls(m.text), withoutUrls(m.html)]);

/** I messaggi che la pagina pubblica può mostrare (§4.3 e rilascio 5): fuori dalla dashboard. */
const PUBLIC_ERROR_CODES = new Set([
  "link_non_valido", "informativa_da_leggere", "informativa_cambiata", "gia_inviata", "risposte_da_correggere", "nessuna_risposta",
  "risposta_vuota_pubblica", "non_so_con_file", "file_in_controllo", "file_gia_inviato", "modalita_non_disponibile",
  "domanda_non_disponibile_pubblica", "pdf_in_revisione", "revisione_rifiutata", "revisione_scaduta", "nessun_altro_revisore",
  "quarantena_scaduta", "conferma_mancante", "stima_mancante", "stima_cambiata", "numero_non_valido", "nota_troppo_lunga",
  "commento_troppo_lungo", "domande_aperte", "domande_aperte_una", "domanda_aperta", "domanda_aperta_file", "domande_nuove",
]);
const publicErrors = Object.entries(REFERENT_ERROR_MESSAGES).filter(([code]) => PUBLIC_ERROR_CODES.has(code)).map(([, text]) => text);
const teamErrors = Object.entries(REFERENT_ERROR_MESSAGES).filter(([code]) => !PUBLIC_ERROR_CODES.has(code)).map(([, text]) => text);

/** Nella dashboard. */
const DASHBOARD = [
  ...strings(REFERENT_UI_TEXT),
  ...teamErrors,
  ...strings(REFERENT_REQUEST_WORD),
  ...strings(REFERENT_HISTORY_TEXT),
  ...strings(HISTORY_ACTOR_TEXT),
  ...strings(PREPARED_QUESTIONS),
  ...strings(BELL_TEXT),
  ...strings(INFO_PROGRESS_TEXT),
  ...strings(USE_CASE_NOTICE_TEXT),
];

/** Fuori dalla dashboard: la pagina pubblica e le email. */
const OUTSIDE = [
  ...strings(REFERENT_PUBLIC_TEXT),
  ...strings(REFERENT_CHECK_TEXT),
  ...strings(REFERENT_IMPACT_TEXT),
  ...publicErrors,
  ...strings(REFERENT_PRIVACY_NOTICE),
  ...strings(privacyNoticeTexts({ company: "TopJet", expires: "26 novembre 2026", requester: "Giulia Neri", contact: "privacy@example.test" })),
  ...emailTexts,
];

test("i testi ci sono", () => {
  assert.ok(DASHBOARD.length > 150, String(DASHBOARD.length));
  assert.ok(OUTSIDE.length > 100, String(OUTSIDE.length));
  assert.ok(publicErrors.length >= PUBLIC_ERROR_CODES.size - 1, "i codici pubblici esistono");
});

test("dashboard: nessun testo con le parole vietate dell'area, mai «caso d'uso»", () => {
  const hits = DASHBOARD.flatMap((text) => findHubForbidden(text, "area").map((m) => `${m.rule}: ${text}`));
  assert.deepEqual(hits, []);
});

test("(rilascio 5.1) pagina pubblica ed email: «caso d'uso», mai «use case» né le altre parole vietate", () => {
  const hits = OUTSIDE.flatMap((text) => findHubForbidden(text, "esterno").map((m) => `${m.rule}: ${text}`));
  assert.deepEqual(hits, []);
  // E «caso d'uso» c'è davvero: nei passi, nell'informativa, in ogni oggetto.
  assert.equal(REFERENT_CHECK_TEXT.steps.useCase, "Il caso d'uso");
  assert.equal(REFERENT_CHECK_TEXT.confirm.group, "Il caso d'uso è descritto bene?");
  for (const m of emails) assert.match(m.subject, /^TopJet: /, m.subject);
  for (const m of emails.slice(0, 7)) assert.match(m.subject, /cas[oi] d'uso/, m.subject);
});

test("nessuna parola tecnica per i clienti", () => {
  assert.deepEqual([...DASHBOARD, ...OUTSIDE].filter((t) => TECH.test(t)), []);
});

test("le scelte si chiamano «A posto», «Risposta parziale», «Manca il dato»: mai «validata», «Parziale» o «Mancante»", () => {
  const texts = [...strings(BELL_TEXT), ...strings(INFO_PROGRESS_TEXT), ...strings(USE_CASE_NOTICE_TEXT), ...strings(REFERENT_UI_TEXT)];
  assert.deepEqual(texts.filter((t) => /\bvalidat[ao]\b/i.test(t) || /«(Parziale|Mancante)»|^(Parziale|Mancante)$/.test(t)), []);
});
