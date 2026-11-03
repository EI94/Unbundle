import test from "node:test";
import assert from "node:assert/strict";
import { render } from "../../uc/notify/email-render.ts";
import { REFERENT_LIMITS } from "./contract.ts";
import { ACCOUNT_NOTICE_LINE, ACCOUNT_NOTICE_LINE_MANY, TEAM_ACCESS_LINE, TEAM_ACCESS_LINE_MANY, checkReferentLink, referentRequestParts, renderReferentEmail } from "./email.ts";
import { PREVIEW_FOOTER, PREVIEW_LINK, PREVIEW_SENDER, previewBlocks, referentRequestPreview, requesterNameOf } from "./preview.ts";

// «Controlla e invia» (rilascio 4, §9.2): l'anteprima è l'email vera. Dati inventati.
const LINK = `https://app.example.test/rispondi/ucq_${"A".repeat(32)}`;
const CARD = "https://app.example.test/dashboard/5e1a0000-0000-4000-8000-0000000000a1/use-cases/5e1a0000-0000-4000-8000-0000000000b1?capitolo=cosa-serve";
const TODAY = new Date("2026-11-02T09:30:00Z");
const EXPIRES = new Date(TODAY.getTime() + REFERENT_LIMITS.linkDays * 86_400_000);
const UC = { code: "AJ-0002", title: "Lettura delle fatture estere" };
type Richiesta = Parameters<typeof referentRequestParts>[0];
const base: Richiesta = { template: "richiesta", company: "Alfa Jet (prova)", useCase: UC, requesterName: "Aldo Prova", questions: 1, message: null, expiresAt: EXPIRES, link: LINK, replyToKnown: true };

test("l'email vera passa da referentRequestParts: stesso oggetto, stesso testo, stesso HTML in ogni variante", () => {
  const variants: Record<string, Richiesta> = {
    una: base,
    molte: { ...base, questions: 7 },
    messaggio: { ...base, questions: 3, message: "Ci serve per la stima\r\ndi fine mese." },
    team: { ...base, questions: 2, cardLink: CARD },
    account: { ...base, questions: 2, accountNotice: true },
  };
  for (const [label, input] of Object.entries(variants)) {
    const parts = referentRequestParts(input);
    assert.deepEqual(render(parts.subject, parts.blocks), renderReferentEmail(input), label);
  }
});

test("l'anteprima: oggetto e blocchi uguali all'email vera con il link finto e la scadenza di oggi più 30 giorni", () => {
  for (const [questions, message] of [
    [1, null],
    [6, null],
    [2, "Grazie in anticipo!"],
  ] as const) {
    const preview = referentRequestPreview({ company: "Alfa Jet (prova)", useCase: UC, requesterName: "Aldo Prova", questions, message, today: TODAY });
    const real = referentRequestParts({ ...base, questions, message, link: PREVIEW_LINK });
    assert.deepEqual(preview, real, `${questions} domande, messaggio ${message ?? "no"}`);
  }
  const one = referentRequestPreview({ company: "Alfa Jet (prova)", useCase: UC, requesterName: "Aldo Prova", questions: 1, message: null, today: TODAY });
  assert.equal(one.subject, "Alfa Jet (prova): alcune domande su «AJ-0002 · Lettura delle fatture estere»");
  // (Rilascio 5) La richiesta al referente: la stessa email dell'invio, con la conferma e la stima.
  const referent = referentRequestPreview({ kind: "referente", company: "Alfa Jet (prova)", useCase: UC, requesterName: "Aldo Prova", questions: 5, message: null, today: TODAY });
  assert.deepEqual(referent, referentRequestParts({ ...base, kind: "referente", questions: 5, message: null, link: PREVIEW_LINK }));
  assert.equal(referent.subject, "Alfa Jet (prova): sei il referente per «AJ-0002 · Lettura delle fatture estere»");
  assert.ok(one.blocks.some((b) => "small" in b && b.small === "Il link scade il 2 dicembre 2026."), "la scadenza: oggi più 30 giorni");
  assert.ok(one.blocks.some((b) => "p" in b && b.p === "È una domanda sola."));
  assert.ok(one.blocks.some((b) => "small" in b && b.small.endsWith("arriva a Aldo Prova.")), "la risposta all'email arriva a chi chiede");
  assert.equal(checkReferentLink(PREVIEW_LINK), PREVIEW_LINK, "il link finto passa i controlli dell'email");
  assert.equal(PREVIEW_SENDER, "Lateral Space via Unbundle");
  assert.equal(PREVIEW_FOOTER, "Lateral Space via Unbundle.");
});

test("l'anteprima non ha mai la riga del team o dell'account", () => {
  const preview = referentRequestPreview({ company: "Alfa Jet (prova)", useCase: UC, requesterName: "Aldo Prova", questions: 3, message: null, today: TODAY });
  const text = JSON.stringify(preview);
  for (const line of [TEAM_ACCESS_LINE, TEAM_ACCESS_LINE_MANY, ACCOUNT_NOTICE_LINE, ACCOUNT_NOTICE_LINE_MANY, "Apri la scheda", "/dashboard/"]) assert.ok(!text.includes(line), line);
});

test("a schermo il link è solo «Apri le domande»: l'indirizzo finto non si mostra mai", () => {
  const preview = referentRequestPreview({ company: "Alfa Jet (prova)", useCase: UC, requesterName: "Aldo Prova", questions: 2, message: "Una riga\n\ne un'altra", today: TODAY });
  const blocks = previewBlocks(preview);
  assert.deepEqual(
    blocks.map((b) => b.kind),
    ["p", "p", "p", "quote", "p", "link", "small", "small"],
  );
  assert.deepEqual(blocks.find((b) => b.kind === "link"), { kind: "link", label: "Apri le domande" });
  const shown = JSON.stringify(blocks);
  assert.ok(!shown.includes("unbundle.invalid") && !shown.includes("/rispondi/") && !shown.includes("ucq_"), "nessun indirizzo a schermo");
  assert.equal((blocks.find((b) => b.kind === "quote") as { text: string }).text, "Una riga\n\ne un'altra");
});

test("il nome di chi chiede: come lo salva la richiesta, oppure «Il team di …», al massimo 120 caratteri", () => {
  assert.equal(requesterNameOf("  Aldo   Prova ", "Alfa Jet (prova)"), "Aldo Prova");
  assert.equal(requesterNameOf("", "Alfa Jet (prova)"), "Il team di Alfa Jet (prova)");
  assert.equal(requesterNameOf(null, "Alfa Jet (prova)"), "Il team di Alfa Jet (prova)");
  assert.equal(requesterNameOf("   ", "Alfa Jet (prova)"), "Il team di Alfa Jet (prova)");
  assert.equal(requesterNameOf("x".repeat(200), "Alfa Jet").length, 120);
  assert.equal(requesterNameOf(null, "y".repeat(200)).length, 120);
  assert.ok(requesterNameOf(null, "y".repeat(200)).startsWith("Il team di "));
});
