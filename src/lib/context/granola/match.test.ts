import test from "node:test";
import assert from "node:assert/strict";
import { defaultTitleWords, isPublicMailDomain, matchMeeting, PUBLIC_MAIL_DOMAINS, titleHasWord, type WorkspaceMatchProfile } from "./match.ts";

// Di quale cliente è una call (RILASCIO-9a-COSTRUZIONE.md §8.6). Clienti, persone e domini inventati.

const LS = ["ls.test", "volta.test"];
const NARDI: WorkspaceMatchProfile = { workspaceId: "ws-nardi", folderIds: ["f-nardi"], emails: ["giulia@nardi.test"], domains: [], titleWords: ["Nardi"] };
const TOPJET: WorkspaceMatchProfile = { workspaceId: "ws-topjet", folderIds: ["f-topjet"], emails: ["luca@topjet.test"], domains: ["topjet.test"], titleWords: ["TopJet"] };
const PROFILES = [NARDI, TOPJET];

const meeting = (over: Partial<{ title: string; participantEmails: string[]; folderIds: string[] }> = {}) => ({ title: "Call", participantEmails: [], folderIds: [], ...over });

test("la cartella vince sui partecipanti: una call nella cartella di Nardi con una persona di TopJet entra in Nardi", () => {
  assert.deepEqual(matchMeeting(meeting({ folderIds: ["f-nardi"], participantEmails: ["luca@topjet.test"] }), PROFILES, LS), { rule: "cartella", workspaceIds: ["ws-nardi"] });
});

test("i partecipanti vincono sul titolo di nessun cliente: una persona di Nardi → Nardi", () => {
  assert.deepEqual(matchMeeting(meeting({ title: "Allineamento ordini", participantEmails: ["GIULIA@nardi.test"] }), PROFILES, LS), { rule: "partecipanti", workspaceIds: ["ws-nardi"] });
});

test("un titolo che dice un altro cliente manda la call in «Da smistare», anche con la cartella o i partecipanti", () => {
  assert.deepEqual(matchMeeting(meeting({ title: "Allineamento TopJet", participantEmails: ["GIULIA@nardi.test"] }), PROFILES, LS), { rule: "partecipanti", workspaceIds: ["ws-nardi", "ws-topjet"] });
  assert.deepEqual(matchMeeting(meeting({ title: "Nardi, ma per TopJet", folderIds: ["f-nardi"] }), PROFILES, LS), { rule: "cartella", workspaceIds: ["ws-nardi", "ws-topjet"] });
  // Il titolo del cliente stesso non cambia niente.
  assert.deepEqual(matchMeeting(meeting({ title: "Ordini Nardi", folderIds: ["f-nardi"] }), PROFILES, LS), { rule: "cartella", workspaceIds: ["ws-nardi"] });
});

test("le caselle pubbliche (Gmail, Outlook, Libero…): mai come dominio, nemmeno in una regola vecchia; un indirizzo intero vale per sé, solo uguale", () => {
  for (const domain of ["gmail.com", "outlook.com", "hotmail.com", "yahoo.com", "icloud.com", "libero.it", "virgilio.it", "alice.it", "tiscali.it"]) {
    assert.ok(PUBLIC_MAIL_DOMAINS.includes(domain), domain);
    assert.equal(isPublicMailDomain(domain), true, domain);
  }
  assert.equal(isPublicMailDomain("@GMAIL.com"), true);
  assert.equal(isPublicMailDomain("mail.libero.it"), true, "un sottodominio");
  assert.equal(isPublicMailDomain("nardi.test"), false);
  assert.equal(isPublicMailDomain("notgmail.com"), false);
  assert.equal(isPublicMailDomain(""), false);
  const gmail: WorkspaceMatchProfile = { workspaceId: "ws-gmail", folderIds: [], emails: ["alessio@gmail.com"], domains: ["gmail.com"], titleWords: [] };
  // L'indirizzo scritto a mano: la stessa persona sì, per uguale.
  assert.deepEqual(matchMeeting(meeting({ participantEmails: ["ALESSIO@gmail.com"] }), [gmail, ...PROFILES], LS), { rule: "partecipanti", workspaceIds: ["ws-gmail"] });
  // Un altro indirizzo della stessa casella no: il dominio «gmail.com» di una regola vecchia non vale.
  assert.deepEqual(matchMeeting(meeting({ participantEmails: ["chiunque@gmail.com", "altro@mail.gmail.com"] }), [gmail, ...PROFILES], LS), { rule: null, workspaceIds: [] });
});

test("con solo chi registra e «Nardi» nel titolo la call entra in Nardi", () => {
  assert.deepEqual(matchMeeting(meeting({ title: "Call di avvio Nardi", participantEmails: ["paola@ls.test"] }), PROFILES, LS), { rule: "titolo", workspaceIds: ["ws-nardi"] });
});

test("due workspace allo stesso livello → nessuno: va in «Da smistare»", () => {
  assert.deepEqual(matchMeeting(meeting({ title: "Nardi e TopJet a confronto" }), PROFILES, LS), { rule: "titolo", workspaceIds: ["ws-nardi", "ws-topjet"] });
  assert.deepEqual(matchMeeting(meeting({ participantEmails: ["giulia@nardi.test", "luca@topjet.test"] }), PROFILES, LS).workspaceIds.length, 2);
  assert.deepEqual(matchMeeting(meeting({ folderIds: ["f-nardi", "f-topjet"] }), PROFILES, LS).workspaceIds.length, 2);
  assert.deepEqual(matchMeeting(meeting({ title: "Riunione interna" }), PROFILES, LS), { rule: null, workspaceIds: [] });
});

test("i domini di Lateral Space non contano, nemmeno quando sono scritti tra le persone del cliente", () => {
  const wrong: WorkspaceMatchProfile = { workspaceId: "ws-sbagliato", folderIds: [], emails: ["paola@ls.test"], domains: ["volta.test"], titleWords: [] };
  assert.deepEqual(matchMeeting(meeting({ participantEmails: ["paola@ls.test", "anna@sub.volta.test"] }), [wrong], LS), { rule: null, workspaceIds: [] });
});

test("un dominio aggiunto a mano vale anche per i sottodomini; un indirizzo di un altro dominio no", () => {
  assert.deepEqual(matchMeeting(meeting({ participantEmails: ["nuovo@topjet.test"] }), PROFILES, LS).workspaceIds, ["ws-topjet"]);
  assert.deepEqual(matchMeeting(meeting({ participantEmails: ["nuovo@milano.topjet.test"] }), PROFILES, LS).workspaceIds, ["ws-topjet"]);
  assert.deepEqual(matchMeeting(meeting({ participantEmails: ["nuovo@nottopjet.test"] }), PROFILES, LS).workspaceIds, []);
  // Un indirizzo di Nardi non dà il dominio di Nardi: da una persona non si ricava un dominio.
  assert.deepEqual(matchMeeting(meeting({ participantEmails: ["altro@nardi.test"] }), PROFILES, LS).workspaceIds, []);
});

test("titolo: parola intera, senza maiuscole e accenti; «Nardi» non è in «Bernardini»", () => {
  assert.equal(titleHasWord("Call con Bernardini", "Nardi"), false);
  assert.equal(titleHasWord("call nardi/ordini", "Nardi"), true);
  assert.equal(titleHasWord("Nardi's review", "nardi"), true);
  assert.equal(titleHasWord("Società Àgile, revisione", "societa agile"), true, "più parole insieme, accenti e maiuscole a parte");
  assert.equal(titleHasWord("Nardi2026", "Nardi"), false);
  assert.equal(titleHasWord("", "Nardi"), false);
  assert.equal(titleHasWord("Nardi", " "), false);
  assert.deepEqual(matchMeeting(meeting({ title: "Bernardini e soci" }), PROFILES, LS).workspaceIds, []);
});

test("le parole predefinite: la prima parola di almeno 4 lettere che non è generica, una sola", () => {
  assert.deepEqual(defaultTitleWords("Nardi Motorsport"), ["Nardi"]);
  assert.deepEqual(defaultTitleWords("Officina Nardi"), ["Officina"]);
  assert.deepEqual(defaultTitleWords("TopJet Rosa"), ["TopJet"]);
  assert.deepEqual(defaultTitleWords("Gruppo Acme S.p.A."), ["Acme"]);
  assert.deepEqual(defaultTitleWords("Società Àlfa"), ["Àlfa"]);
  assert.deepEqual(defaultTitleWords("Lateral Space"), []);
  assert.deepEqual(defaultTitleWords("Cliente B di prova"), []);
  assert.deepEqual(defaultTitleWords("3M Italia"), [], "«3M» ha una lettera sola, «Italia» è generica");
  assert.deepEqual(defaultTitleWords(""), []);
});
