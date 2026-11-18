import test from "node:test";
import assert from "node:assert/strict";
import { defaultTitleWords, isPublicMailDomain, matchMeeting, PUBLIC_MAIL_DOMAINS, titleHasWord, type WorkspaceMatchProfile } from "./match.ts";

// Di quale cliente è una call (RILASCIO-9a-COSTRUZIONE.md §8.6). Clienti, persone e domini inventati.

const LS = ["ls.test", "volta.test"];
const ALFA: WorkspaceMatchProfile = { workspaceId: "ws-alfa", folderIds: ["f-alfa"], emails: ["giulia@alfa.test"], domains: [], titleWords: ["Alfa"] };
const BETA: WorkspaceMatchProfile = { workspaceId: "ws-beta", folderIds: ["f-beta"], emails: ["luca@beta.test"], domains: ["beta.test"], titleWords: ["Beta"] };
const PROFILES = [ALFA, BETA];

const meeting = (over: Partial<{ title: string; participantEmails: string[]; folderIds: string[] }> = {}) => ({ title: "Call", participantEmails: [], folderIds: [], ...over });

test("la cartella vince sui partecipanti: una call nella cartella di Alfa con una persona di Beta entra in Alfa", () => {
  assert.deepEqual(matchMeeting(meeting({ folderIds: ["f-alfa"], participantEmails: ["luca@beta.test"] }), PROFILES, LS), { rule: "cartella", workspaceIds: ["ws-alfa"] });
});

test("i partecipanti vincono sul titolo di nessun cliente: una persona di Alfa → Alfa", () => {
  assert.deepEqual(matchMeeting(meeting({ title: "Allineamento ordini", participantEmails: ["GIULIA@alfa.test"] }), PROFILES, LS), { rule: "partecipanti", workspaceIds: ["ws-alfa"] });
});

test("un titolo che dice un altro cliente manda la call in «Da smistare», anche con la cartella o i partecipanti", () => {
  assert.deepEqual(matchMeeting(meeting({ title: "Allineamento Beta", participantEmails: ["GIULIA@alfa.test"] }), PROFILES, LS), { rule: "partecipanti", workspaceIds: ["ws-alfa", "ws-beta"] });
  assert.deepEqual(matchMeeting(meeting({ title: "Alfa, ma per Beta", folderIds: ["f-alfa"] }), PROFILES, LS), { rule: "cartella", workspaceIds: ["ws-alfa", "ws-beta"] });
  // Il titolo del cliente stesso non cambia niente.
  assert.deepEqual(matchMeeting(meeting({ title: "Ordini Alfa", folderIds: ["f-alfa"] }), PROFILES, LS), { rule: "cartella", workspaceIds: ["ws-alfa"] });
});

test("le caselle pubbliche (Gmail, Outlook, Libero…): mai come dominio, nemmeno in una regola vecchia; un indirizzo intero vale per sé, solo uguale", () => {
  for (const domain of ["gmail.com", "outlook.com", "hotmail.com", "yahoo.com", "icloud.com", "libero.it", "virgilio.it", "alice.it", "tiscali.it"]) {
    assert.ok(PUBLIC_MAIL_DOMAINS.includes(domain), domain);
    assert.equal(isPublicMailDomain(domain), true, domain);
  }
  assert.equal(isPublicMailDomain("@GMAIL.com"), true);
  assert.equal(isPublicMailDomain("mail.libero.it"), true, "un sottodominio");
  assert.equal(isPublicMailDomain("alfa.test"), false);
  assert.equal(isPublicMailDomain("notgmail.com"), false);
  assert.equal(isPublicMailDomain(""), false);
  const gmail: WorkspaceMatchProfile = { workspaceId: "ws-gmail", folderIds: [], emails: ["sandro@gmail.com"], domains: ["gmail.com"], titleWords: [] };
  // L'indirizzo scritto a mano: la stessa persona sì, per uguale.
  assert.deepEqual(matchMeeting(meeting({ participantEmails: ["SANDRO@gmail.com"] }), [gmail, ...PROFILES], LS), { rule: "partecipanti", workspaceIds: ["ws-gmail"] });
  // Un altro indirizzo della stessa casella no: il dominio «gmail.com» di una regola vecchia non vale.
  assert.deepEqual(matchMeeting(meeting({ participantEmails: ["chiunque@gmail.com", "altro@mail.gmail.com"] }), [gmail, ...PROFILES], LS), { rule: null, workspaceIds: [] });
});

test("con solo chi registra e «Alfa» nel titolo la call entra in Alfa", () => {
  assert.deepEqual(matchMeeting(meeting({ title: "Call di avvio Alfa", participantEmails: ["paola@ls.test"] }), PROFILES, LS), { rule: "titolo", workspaceIds: ["ws-alfa"] });
});

test("due workspace allo stesso livello → nessuno: va in «Da smistare»", () => {
  assert.deepEqual(matchMeeting(meeting({ title: "Alfa e Beta a confronto" }), PROFILES, LS), { rule: "titolo", workspaceIds: ["ws-alfa", "ws-beta"] });
  assert.deepEqual(matchMeeting(meeting({ participantEmails: ["giulia@alfa.test", "luca@beta.test"] }), PROFILES, LS).workspaceIds.length, 2);
  assert.deepEqual(matchMeeting(meeting({ folderIds: ["f-alfa", "f-beta"] }), PROFILES, LS).workspaceIds.length, 2);
  assert.deepEqual(matchMeeting(meeting({ title: "Riunione interna" }), PROFILES, LS), { rule: null, workspaceIds: [] });
});

test("i domini di Lateral Space non contano, nemmeno quando sono scritti tra le persone del cliente", () => {
  const wrong: WorkspaceMatchProfile = { workspaceId: "ws-sbagliato", folderIds: [], emails: ["paola@ls.test"], domains: ["volta.test"], titleWords: [] };
  assert.deepEqual(matchMeeting(meeting({ participantEmails: ["paola@ls.test", "anna@sub.volta.test"] }), [wrong], LS), { rule: null, workspaceIds: [] });
});

test("un dominio aggiunto a mano vale anche per i sottodomini; un indirizzo di un altro dominio no", () => {
  assert.deepEqual(matchMeeting(meeting({ participantEmails: ["nuovo@beta.test"] }), PROFILES, LS).workspaceIds, ["ws-beta"]);
  assert.deepEqual(matchMeeting(meeting({ participantEmails: ["nuovo@milano.beta.test"] }), PROFILES, LS).workspaceIds, ["ws-beta"]);
  assert.deepEqual(matchMeeting(meeting({ participantEmails: ["nuovo@notbeta.test"] }), PROFILES, LS).workspaceIds, []);
  // Un indirizzo di Alfa non dà il dominio di Alfa: da una persona non si ricava un dominio.
  assert.deepEqual(matchMeeting(meeting({ participantEmails: ["altro@alfa.test"] }), PROFILES, LS).workspaceIds, []);
});

test("titolo: parola intera, senza maiuscole e accenti; «Alfa» non è in «Malfatti»", () => {
  assert.equal(titleHasWord("Call con Malfatti", "Alfa"), false);
  assert.equal(titleHasWord("call alfa/ordini", "Alfa"), true);
  assert.equal(titleHasWord("Alfa's review", "alfa"), true);
  assert.equal(titleHasWord("Società Àgile, revisione", "societa agile"), true, "più parole insieme, accenti e maiuscole a parte");
  assert.equal(titleHasWord("Alfa2026", "Alfa"), false);
  assert.equal(titleHasWord("", "Alfa"), false);
  assert.equal(titleHasWord("Alfa", " "), false);
  assert.deepEqual(matchMeeting(meeting({ title: "Malfatti e soci" }), PROFILES, LS).workspaceIds, []);
});

test("le parole predefinite: la prima parola di almeno 4 lettere che non è generica, una sola", () => {
  assert.deepEqual(defaultTitleWords("Alfa Ricambi"), ["Alfa"]);
  assert.deepEqual(defaultTitleWords("Officina Alfa"), ["Officina"]);
  assert.deepEqual(defaultTitleWords("Beta Rosa"), ["Beta"]);
  assert.deepEqual(defaultTitleWords("Gruppo Acme S.p.A."), ["Acme"]);
  assert.deepEqual(defaultTitleWords("Società Àlfa"), ["Àlfa"]);
  assert.deepEqual(defaultTitleWords("Lateral Space"), []);
  assert.deepEqual(defaultTitleWords("Cliente B di prova"), []);
  assert.deepEqual(defaultTitleWords("3M Italia"), [], "«3M» ha una lettera sola, «Italia» è generica");
  assert.deepEqual(defaultTitleWords(""), []);
});
