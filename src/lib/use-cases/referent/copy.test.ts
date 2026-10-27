import test from "node:test";
import assert from "node:assert/strict";
import { findHubForbidden } from "../copy-guard.ts";
import { INFO_PROGRESS_TEXT } from "../info-progress.ts";
import { USE_CASE_NOTICE_TEXT } from "../notices.ts";
import { BELL_TEXT } from "../../notifications/bell.ts";
import { renderRequesterAlert } from "./alerts.ts";
import { renderReferentEmail } from "./email.ts";
import { HISTORY_ACTOR_TEXT, REFERENT_HISTORY_TEXT } from "./history.ts";
import {
  REFERENT_ERROR_MESSAGES,
  REFERENT_PRIVACY_NOTICE,
  REFERENT_PUBLIC_TEXT,
  REFERENT_SILENT_STATUS,
  REFERENT_STATUS_LABEL,
  REFERENT_UI_TEXT,
  privacyNoticeTexts,
} from "./labels.ts";
import { PREPARED_QUESTIONS } from "./prepare.ts";

// I testi di «Chiedi al referente», della campanella e di «Raccolta informazioni»: «use case», mai
// «caso d'uso» né «wave»; niente parole tecniche per i clienti (SPEC §5, §7, §P2.10).
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

const emails = [
  renderReferentEmail({ template: "richiesta", company: "TopJet", useCase: UC, requesterName: "Giulia Neri", questions: 2, message: "Grazie", expiresAt: EXPIRES, link: LINK, replyToKnown: true }),
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
  renderReferentEmail({ template: "conferma", company: "TopJet", useCase: UC, requesterName: "Giulia Neri", submitted: 2, openQuestions: 1, expiresAt: EXPIRES }),
  renderRequesterAlert({
    company: "TopJet",
    entries: [{ useCase: UC, answers: 2, unknowns: 1, documents: 1, followUp: "scaduta", link: "https://app.example.test/dashboard/x" }],
  }),
].flatMap((m) => [m.subject, m.text, m.html]);

const ALL = [
  ...strings(REFERENT_UI_TEXT),
  ...strings(REFERENT_PUBLIC_TEXT),
  ...strings(REFERENT_ERROR_MESSAGES),
  ...strings(REFERENT_STATUS_LABEL),
  ...strings(REFERENT_SILENT_STATUS),
  ...strings(REFERENT_PRIVACY_NOTICE),
  ...strings(privacyNoticeTexts({ company: "TopJet", expires: "26 novembre 2026", requester: "Giulia Neri", contact: "privacy@example.test" })),
  ...strings(REFERENT_HISTORY_TEXT),
  ...strings(HISTORY_ACTOR_TEXT),
  ...strings(PREPARED_QUESTIONS),
  ...strings(BELL_TEXT),
  ...strings(INFO_PROGRESS_TEXT),
  ...strings(USE_CASE_NOTICE_TEXT),
  ...emails,
];

test("i testi ci sono", () => {
  assert.ok(ALL.length > 150, String(ALL.length));
});

test("nessun testo con le parole vietate dell'area", () => {
  const hits = ALL.flatMap((text) => findHubForbidden(text, "area").map((m) => `${m.rule}: ${text}`));
  assert.deepEqual(hits, []);
});

test("nessuna parola tecnica per i clienti, mai «caso d'uso»", () => {
  assert.deepEqual(ALL.filter((t) => TECH.test(t) || /casi? d'uso/i.test(t)), []);
});

test("le scelte si chiamano «A posto», «Risposta parziale», «Manca il dato»: mai «validata», «Parziale» o «Mancante»", () => {
  const texts = [...strings(BELL_TEXT), ...strings(INFO_PROGRESS_TEXT), ...strings(USE_CASE_NOTICE_TEXT), ...strings(REFERENT_UI_TEXT)];
  assert.deepEqual(texts.filter((t) => /\bvalidat[ao]\b/i.test(t) || /«(Parziale|Mancante)»|^(Parziale|Mancante)$/.test(t)), []);
});
