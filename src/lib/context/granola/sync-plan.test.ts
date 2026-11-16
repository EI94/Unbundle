import test from "node:test";
import assert from "node:assert/strict";
import type { GranolaMeetingNote } from "./parse.ts";
import {
  changedSince,
  cleanGranolaRules,
  composeGranolaNote,
  GRANOLA_LIMITS,
  needsFullRun,
  participantEmails,
  planGivesTranscripts,
  sameWords,
  searchWindow,
  stepFor,
} from "./sync-plan.ts";

// Le regole del giro di Granola (RILASCIO-9a-COSTRUZIONE.md §8.6, §8.7), senza database e senza rete. Dati inventati.

const NOW = new Date("2026-11-16T10:00:00Z");
const note = (over: Partial<GranolaMeetingNote> = {}): GranolaMeetingNote => ({
  id: "m-1",
  title: "Avvio progetto",
  meetingAt: "2026-11-14T23:30:00Z",
  updatedAt: "2026-11-15T08:00:00Z",
  url: "https://note.esempio.test/d/m-1",
  participantsRaw: "Giulia Bianchi (giulia@nardi.test)",
  participants: [{ name: "Giulia Bianchi", email: "giulia@nardi.test", company: null, noteCreator: false }],
  summary: "Il gestionale è SAP.",
  privateNotes: "Richiamare giovedì.",
  ...over,
});

test("una call già vista: fuori si salta; entrata si rilegge solo se è cambiata; bloccata si riprova solo se è cambiata", () => {
  const before = new Date("2026-11-15T08:00:00Z");
  assert.equal(stepFor("2026-11-15T09:00:00Z", undefined), "decidi");
  assert.equal(stepFor("2026-11-15T09:00:00Z", { decision: "fuori", meetingUpdatedAt: before }), "salta");
  assert.equal(stepFor("2026-11-15T09:00:00Z", { decision: "entrata", meetingUpdatedAt: before }), "rileggi");
  assert.equal(stepFor("2026-11-15T08:00:00Z", { decision: "entrata", meetingUpdatedAt: before }), "salta", "non più nuova");
  assert.equal(stepFor("2026-11-15T09:00:00Z", { decision: "bloccata", meetingUpdatedAt: before }), "riprova");
  assert.equal(stepFor("2026-11-15T07:00:00Z", { decision: "bloccata", meetingUpdatedAt: before }), "salta");
  assert.equal(stepFor(null, { decision: "entrata", meetingUpdatedAt: before }), "salta", "senza una data di Granola non si rilegge");
  assert.equal(changedSince("2026-11-15T09:00:00Z", null), true);
  assert.equal(changedSince("data rotta", null), false);
});

test("il giro intero la prima volta, senza un giro riuscito, o dopo una regola cambiata; altrimenti il giro breve", () => {
  const at = (iso: string) => new Date(iso);
  assert.equal(needsFullRun({ syncedThrough: null, lastSyncOkAt: at("2026-11-15T10:00:00Z"), rulesChangedAt: null }), true);
  assert.equal(needsFullRun({ syncedThrough: at("2026-11-15T09:00:00Z"), lastSyncOkAt: null, rulesChangedAt: null }), true);
  assert.equal(needsFullRun({ syncedThrough: at("2026-11-15T09:00:00Z"), lastSyncOkAt: at("2026-11-15T10:00:00Z"), rulesChangedAt: at("2026-11-15T10:30:00Z") }), true);
  assert.equal(needsFullRun({ syncedThrough: at("2026-11-15T09:00:00Z"), lastSyncOkAt: at("2026-11-15T10:00:00Z"), rulesChangedAt: at("2026-11-15T09:30:00Z") }), false);
  assert.equal(needsFullRun({ syncedThrough: at("2026-11-15T09:00:00Z"), lastSyncOkAt: at("2026-11-15T10:00:00Z"), rulesChangedAt: null }), false);
  // Il giro intero: gli ultimi 30 giorni, con le date di Roma. Il giro breve: 10 minuti prima dell'ultimo visto, senza date.
  assert.deepEqual(searchWindow(true, null, NOW), { from_date: "2026-10-17", to_date: "2026-11-16" });
  assert.deepEqual(searchWindow(false, at("2026-11-15T09:00:00Z"), NOW), { updated_after: "2026-11-15T08:50:00.000Z" });
  assert.deepEqual(searchWindow(false, null, NOW), { from_date: "2026-10-17", to_date: "2026-11-16" });
  assert.deepEqual(searchWindow(true, null, new Date("2026-11-15T23:30:00Z")).to_date, "2026-11-16", "a Roma è già il 16");
});

test("una nota come appunto: riassunto e note sotto le loro etichette; il giorno della call a Roma; il link solo https", () => {
  const composed = composeGranolaNote(note(), null, NOW);
  assert.deepEqual(composed, {
    title: "Avvio progetto",
    body: "[Riassunto di Granola]\nIl gestionale è SAP.\n\n[Note di chi ha registrato]\nRichiamare giovedì.",
    kind: "appunti",
    occurredOn: "2026-11-15",
    participants: "Giulia Bianchi (giulia@nardi.test)",
    link: "https://note.esempio.test/d/m-1",
    transcriptCut: false,
  });
  assert.equal(composeGranolaNote(note({ summary: null }), null, NOW)?.body, "[Note di chi ha registrato]\nRichiamare giovedì.");
  assert.equal(composeGranolaNote(note({ summary: "  ", privateNotes: null }), null, NOW), null, "senza riassunto e senza note la call si salta");
  assert.equal(composeGranolaNote(note({ url: "http://note.esempio.test/d/1" }), null, NOW)?.link, null);
  assert.equal(composeGranolaNote(note({ url: `https://note.esempio.test/${"x".repeat(600)}` }), null, NOW)?.link, null);
  assert.equal(composeGranolaNote(note({ meetingAt: null }), null, NOW)?.occurredOn, "2026-11-15", "senza la data della call, quella dell'ultima modifica");
  assert.equal(composeGranolaNote(note({ meetingAt: null, updatedAt: null }), null, NOW)?.occurredOn, "2026-11-16");
  // Un titolo che manca: «Call» e il giorno, come nelle righe.
  assert.equal(composeGranolaNote(note({ title: " " }), null, NOW)?.title, "Call 15 nov");
  assert.equal(composeGranolaNote(note({ title: "x".repeat(250) }), null, NOW)?.title.length, 200);
  assert.equal(composeGranolaNote(note({ participantsRaw: `${"Persona, ".repeat(100)}` }), null, NOW)?.participants?.length, 500);
});

test("la trascrizione: sotto la sua etichetta; oltre 300.000 caratteri si accorcia e il titolo lo dice", () => {
  const withTranscript = composeGranolaNote(note(), { text: "Parla il direttore.", partial: false }, NOW);
  assert.equal(withTranscript?.kind, "trascrizione");
  assert.match(withTranscript?.body ?? "", /\n\n\[Trascrizione\]\nParla il direttore\.$/);
  assert.equal(withTranscript?.transcriptCut, false);
  const long = composeGranolaNote(note(), { text: "parola ".repeat(60_000), partial: false }, NOW);
  assert.equal(long?.body.length, GRANOLA_LIMITS.bodyMax);
  assert.equal(long?.transcriptCut, true);
  assert.equal(long?.title, "Avvio progetto (trascrizione in parte)");
  const partial = composeGranolaNote(note({ title: "t".repeat(199) }), { text: "breve", partial: true }, NOW);
  assert.equal(partial?.title.length, 200);
  assert.match(partial?.title ?? "", / \(trascrizione in parte\)$/);
  assert.equal(composeGranolaNote(note(), { text: "   ", partial: false }, NOW)?.kind, "appunti");
});

test("le e-mail che contano: senza chi ha registrato e senza l'account collegato", () => {
  assert.deepEqual(
    participantEmails(
      [
        { name: "Paola", email: "paola@ls.test", company: null, noteCreator: true },
        { name: "Paola", email: "paola.granola@altro.test", company: null, noteCreator: false },
        { name: "Giulia", email: "giulia@nardi.test", company: null, noteCreator: false },
        { name: "Giulia", email: "giulia@nardi.test", company: null, noteCreator: false },
        { name: "Senza e-mail", email: null, company: null, noteCreator: false },
      ],
      "PAOLA.granola@altro.test",
    ),
    ["giulia@nardi.test"],
  );
});

test("il piano gratuito non dà le trascrizioni; un piano sconosciuto si prova", () => {
  assert.equal(planGivesTranscripts("Free"), false);
  assert.equal(planGivesTranscripts("piano gratuito"), false);
  assert.equal(planGivesTranscripts("Basic"), false);
  assert.equal(planGivesTranscripts("Business"), true);
  assert.equal(planGivesTranscripts("Freelancer"), true, "parola intera");
  assert.equal(planGivesTranscripts(null), true);
});

test("le regole pulite: minuscole, senza doppioni, senza Lateral Space; valori sbagliati o troppi, errori per campo", () => {
  const ls = ["ls.test"];
  assert.deepEqual(
    cleanGranolaRules({ folderId: " f-1 ", folderName: "  Nardi   clienti ", emails: ["Giulia@Nardi.test", "giulia@nardi.test", "paola@ls.test", " "], domains: ["@Nardi.test", "sub.ls.test", "nardi.test"], titleWords: [" Nardi ", "nardi", "Ferràri", "ferrari"], wantTranscript: true }, ls),
    { ok: true, value: { folderId: "f-1", folderName: "Nardi clienti", emails: ["giulia@nardi.test"], domains: ["nardi.test"], titleWords: ["Nardi", "Ferràri"], wantTranscript: true } },
  );
  assert.deepEqual(cleanGranolaRules({ folderId: null, folderName: "resta fuori", emails: [], domains: [], titleWords: [], wantTranscript: "sì" as unknown as boolean }, ls), {
    ok: true,
    value: { folderId: null, folderName: null, emails: [], domains: [], titleWords: [], wantTranscript: false },
  });
  assert.deepEqual(cleanGranolaRules(null, ls), { ok: true, value: { folderId: null, folderName: null, emails: [], domains: [], titleWords: [], wantTranscript: false } });
  const wrong = cleanGranolaRules({ emails: ["non-email", "a@b"], domains: ["nardi", "a..b.it"], titleWords: ["x".repeat(61)], folderId: "cartella con spazi" }, ls);
  assert.deepEqual(wrong, {
    ok: false,
    fieldErrors: { emails: "Scrivi un'e-mail o un dominio.", domains: "Scrivi un'e-mail o un dominio.", titleWords: "Al massimo 60 caratteri.", folderId: "Controlla i campi indicati." },
  });
  const many = cleanGranolaRules({ emails: Array.from({ length: 101 }, (_, i) => `p${i}@nardi.test`), domains: Array.from({ length: 31 }, (_, i) => `d${i}.test`), titleWords: Array.from({ length: 21 }, (_, i) => `parola${i}`) }, ls);
  assert.deepEqual(!many.ok && Object.keys(many.fieldErrors).sort(), ["domains", "emails", "titleWords"]);
  // Le caselle pubbliche non dicono di quale cliente è una call: né un dominio, né un indirizzo.
  const publicMail = "Gmail, Outlook e le altre caselle pubbliche non dicono di quale cliente è una call. Usa la cartella o le parole nel titolo.";
  assert.deepEqual(cleanGranolaRules({ emails: ["alessio@gmail.com"], domains: ["@Libero.it"] }, ls), { ok: false, fieldErrors: { emails: publicMail, domains: publicMail } });
  assert.deepEqual(cleanGranolaRules({ emails: ["acquisti@nardi.test"], domains: ["mail.hotmail.com"] }, ls), { ok: false, fieldErrors: { domains: publicMail } });
});

test("le parole uguali alle predefinite, maiuscole e accenti a parte", () => {
  assert.equal(sameWords(["nardi"], ["Nardi"]), true);
  assert.equal(sameWords(["Nardi", "Ferrari"], ["Nardi"]), false);
  assert.equal(sameWords([], []), true);
  assert.equal(sameWords(["Àlfa"], ["alfa"]), true);
});
