import test from "node:test";
import assert from "node:assert/strict";
import { findingMessage } from "../uc/text/scan.ts";
import { isHardIssue, issueMessage, scanNote, scanPersonalData, scanStatement } from "./scan.ts";
import { CONTEXT_TEXT } from "./text.ts";
import { PROPOSAL_ISSUES } from "./vocab.ts";

// Il controllo dei testi di «Contesto» (RILASCIO-9a-COSTRUZIONE.md §3.4.2). Nomi e dati inventati.

test("un appunto: un nome passa (lo vede solo Lateral Space), «visita medica» e una frase che discrimina no", () => {
  assert.deepEqual(scanNote("Mario Rossi dice che il gestionale è SAP Business One. Scrivere a mario.rossi@esempio.test."), { ok: true });
  assert.deepEqual(scanNote(""), { ok: true });
  const health = scanNote("Il direttore operativo è assente per una visita medica fino a lunedì.");
  assert.deepEqual(health, { ok: false, category: "sanitario", term: "visita medica", message: "Negli appunti ci sono dati sanitari («visita medica»). Toglili e riprova." });
  const unfair = scanNote("Per questo ruolo preferiamo solo uomini giovani.");
  assert.equal(unfair.ok, false);
  assert.equal(!unfair.ok && unfair.category, "discriminatorio");
  assert.match(!unfair.ok ? unfair.message : "", /^Negli appunti c'è una frase che discrimina \(«.+»\)\. Toglila e riprova\.$/);
  // Con tutti e due, il dato sanitario si dice per primo.
  const both = scanNote("Preferiamo solo uomini. Il magazziniere ha una visita medica.");
  assert.equal(!both.ok && both.category, "sanitario");
});

test("un fatto con nome e cognome, titolo e cognome, e-mail, telefono, codice fiscale o data di nascita non passa", () => {
  const cases: Array<[string, string]> = [
    ["Mario Rossi decide gli acquisti.", "nome_persona"],
    ["Il dott. Bianchi firma i contratti.", "nome_persona"],
    ["Per gli ordini si scrive a ordini@esempio.test.", "contatto"],
    ["Il magazzino risponde al +39 333 1234567.", "contatto"],
    ["Il codice fiscale del titolare è RSSMRA80A01H501U.", "codice_fiscale"],
    ["Il titolare è nato il 12/03/1970.", "data_nascita"],
  ];
  for (const [text, issue] of cases) {
    const result = scanPersonalData(text);
    assert.deepEqual(result, { ok: false, issue, message: findingMessage(issue as "contatto") }, text);
    assert.deepEqual(scanStatement(text), result, "scanStatement dice lo stesso");
  }
  // Un ruolo, un sistema, un'azienda, un nome proprio da solo: passano.
  for (const text of [
    "Il gestionale è SAP Business One.",
    "Il direttore operativo decide il budget con il responsabile commerciale.",
    "Marco gestisce il magazzino.",
    "L'azienda compra il legno da un fornitore di Udine.",
  ]) {
    assert.deepEqual(scanPersonalData(text), { ok: true }, text);
    assert.deepEqual(scanStatement(text), { ok: true }, text);
  }
});

test("dati sanitari e discriminatori fermano anche un fatto, e vengono prima di ogni altro esito", () => {
  const health = scanPersonalData("Mario Rossi è in malattia da un mese.");
  assert.equal(!health.ok && health.issue, "sanitario");
  assert.equal(!health.ok && isHardIssue(health.issue), true);
  const unfair = scanStatement("Assumiamo solo uomini sotto i 30 anni.");
  assert.equal(!unfair.ok && isHardIssue(unfair.issue), true);
  const name = scanPersonalData("Mario Rossi decide gli acquisti.");
  assert.equal(!name.ok && isHardIssue(name.issue), false);
});

test("un testo lungo senza dati personali passa da scanPersonalData e non da scanStatement; con un nome, il nome viene prima", () => {
  const long = "Il gestionale è SAP Business One e copre ordini, magazzino e fatture. ".repeat(4);
  assert.ok(long.trim().length > 200);
  assert.deepEqual(scanPersonalData(long), { ok: true });
  assert.deepEqual(scanStatement(long), { ok: false, issue: "lungo", message: "Accorcia la frase: al massimo 200 caratteri." });
  assert.deepEqual(scanStatement("x".repeat(200)), { ok: true }, "200 caratteri passano");
  assert.equal(scanStatement("x".repeat(201)).ok, false);
  const longWithName = `${long} Lo dice Mario Rossi.`;
  const result = scanStatement(longWithName);
  assert.equal(!result.ok && result.issue, "nome_persona", "prima si toglie il nome, poi si accorcia");
});

test("i messaggi: quelli dei dossier per i dati di una persona, quello di «Contesto» per la lunghezza", () => {
  for (const issue of PROPOSAL_ISSUES) {
    const message = issueMessage(issue);
    assert.ok(message.length > 10, issue);
    assert.equal(message, issue === "lungo" ? CONTEXT_TEXT.confirm.tooLong : findingMessage(issue));
    assert.doesNotMatch(message, /[a-z]_[a-z]/, "nessuna chiave interna nel messaggio");
  }
  assert.match(issueMessage("nome_persona"), /indica il ruolo/);
});
