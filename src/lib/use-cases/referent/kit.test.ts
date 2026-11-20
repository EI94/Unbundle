import test from "node:test";
import assert from "node:assert/strict";
import { findHubForbidden } from "../copy-guard.ts";
import { REFERENT_AI_NOTICE_LINE } from "./ai-followup.ts";
import { REFERENT_KIT_NOTICE, REFERENT_KIT_TEXT, kitClientLine, kitNoticeTexts, kitProgress } from "./kit.ts";

// (Rilascio 10, D5) Il kit del referente: le parole che `/rispondi` e `/r` dicono uguali e l'informativa calma comune
// alle due pagine. Dati inventati.

function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => strings(v, out));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => strings(v, out));
  return out;
}

test("le parole comuni: «Non lo so», «Iniziamo», «Avanti» senza freccia, le due schede, un solo numero", () => {
  const K = REFERENT_KIT_TEXT;
  assert.equal(K.dontKnow, "Non lo so");
  assert.equal(K.start, "Iniziamo");
  assert.equal(K.next, "Avanti");
  assert.deepEqual({ ...K.linkGone }, { title: "Questo link non vale più.", text: "Rispondi all'email che hai ricevuto: arriva a chi ti ha scritto." });
  assert.deepEqual({ ...K.error }, { title: "Questa pagina non si è caricata.", text: "Le risposte che hai già inviato sono salve.", retry: "Riprova" });
  assert.equal(K.askOther, "Chiedi a un'altra persona", "genere neutro");
  assert.equal(K.reference, "Riferimento");
  assert.equal(kitProgress(2, 5, "saved"), "2 di 5 · salvato");
  assert.equal(kitProgress(3, 12, "saving"), "3 di 12 · salvataggio…");
  assert.equal(kitProgress(2, 5, null), "2 di 5");
  assert.equal(kitClientLine("Cliente Demo"), "Cliente Demo · con Lateral Space");
  assert.equal(kitClientLine("  Cliente   Demo "), "Cliente Demo · con Lateral Space");
  for (const empty of ["", "   ", null, undefined]) assert.equal(kitClientLine(empty), null, String(empty));
});

test("fuori dalla dashboard: nessuna parola vietata, niente inglese, «caso d'uso», mai «Non ce l'ho» né «collega»", () => {
  const texts = [...strings(REFERENT_KIT_TEXT), ...strings(REFERENT_KIT_NOTICE)];
  assert.ok(texts.length > 30);
  for (const text of texts) {
    assert.deepEqual(findHubForbidden(text, "esterno"), [], text);
    assert.doesNotMatch(text, /\b(token|MCP|workflow|login|Chiedi a un collega)\b/i, text);
  }
  assert.ok(texts.some((t) => /casi? d'uso/.test(t)));
});

test("l'informativa comune: una versione nuova, due livelli calmi, valida per le due pagine", () => {
  const n = REFERENT_KIT_NOTICE;
  // La forma delle versioni di `/r` e di `/rispondi`: al massimo 20 caratteri (varchar(20)).
  assert.match(n.version, /^[A-Za-z0-9_.:-]{1,20}$/);
  assert.equal(n.version, "ref-2026-11-1");
  for (const old of ["ucq-2026-11-1", "ucq-2026-11-2", "ucq-2026-11-3", "uc-2026-10-2", "uc-2026-11-1"]) assert.notEqual(n.version, old);
  assert.equal(n.title, "Prima di iniziare");
  assert.equal(n.lead, "Ti chiediamo del tuo lavoro, non di te.");
  assert.equal(n.summary.length, 2, "sopra, due punti");
  assert.equal(n.button, "Iniziamo");
  assert.equal(n.footerLabel, "Come usiamo le tue risposte");
  // Calma: niente che spaventa, niente casella, la privacy detta una volta (sopra nessun allarme su nomi o dati).
  for (const text of [n.lead, ...n.summary]) assert.doesNotMatch(text, /blocc|dati personali|sanitar|nomi|email|telefon|attenzion|rischi|obblig|vietat/i, text);
  for (const text of n.paragraphs) assert.doesNotMatch(text, /il sistema li blocca|blocca|attenzion|obblig|vietat|spunta|casella/i, text);
  // Per le due pagine: valutare e realizzare; chi vede le risposte senza il nome di una persona.
  assert.ok(n.paragraphs[0].includes("per valutare e realizzare i casi d'uso"));
  assert.ok(n.summary[0].includes("le persone di {Azienda} che lavorano ai casi d'uso"));
  for (const text of [...n.summary, ...n.paragraphs]) assert.doesNotMatch(text, /\{(?!Azienda\}|data\}|contatto\})[A-Za-z]+\}/, `nessun segnaposto di una persona: ${text}`);
  // La frase dell'AI parola per parola (aiuto dell'AI e «Contesto» la cercano), i diritti, il Garante, i 12 mesi.
  assert.ok(n.paragraphs.includes(REFERENT_AI_NOTICE_LINE));
  assert.ok(n.paragraphs.some((p) => p.includes("tenere aggiornato quello che sappiamo del lavoro di {Azienda}, senza il tuo nome")));
  assert.ok(n.paragraphs.some((p) => p.includes("Garante per la protezione dei dati personali")));
  assert.ok(n.paragraphs.some((p) => p.includes("12 mesi")));
  assert.ok(n.paragraphs.some((p) => p.includes("nomi, email o telefoni") && p.includes("li usiamo solo per questo")));
  assert.ok(n.paragraphs.some((p) => p.includes("controllo automatico")));
});

test("l'informativa riempita: l'azienda, la scadenza, il contatto; nessun segnaposto vuoto", () => {
  const filled = kitNoticeTexts({ company: "Cliente Demo", expires: "18 dicembre 2026", contact: "privacy@example.test" });
  assert.equal(filled.version, REFERENT_KIT_NOTICE.version);
  assert.equal(filled.summary[1], "Il link è solo tuo e vale fino al 18 dicembre 2026.");
  assert.ok(filled.paragraphs.some((p) => p.includes("scrivendo a privacy@example.test.")));
  assert.ok(filled.paragraphs[0].startsWith("Lateral Space raccoglie queste informazioni per conto di Cliente Demo"));
  assert.ok(![...filled.summary, ...filled.paragraphs].some((t) => /\{[A-Za-z]+\}/.test(t)));
});
