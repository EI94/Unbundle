import test from "node:test";
import assert from "node:assert/strict";
import { scanPersonalData } from "../../context/scan.ts";
import { findForbidden } from "../views/copy-guard.ts";
import { EMAIL_BODY_MAX_WORDS, EMAIL_SUBJECT_MAX, emailBodyWords, emailBrand } from "./email-render.ts";
import { checkEmailLink, clarificationLink, escapeHtml, formatDateIt, renderEmail, UC_EMAIL_SENDER_NAME, type EmailInput, type RenderedEmail } from "./email-templates.ts";

const TOKEN = "ucr_" + "A".repeat(16) + "b_-9".repeat(4);
const LINK = `https://unbundle.example/r/${TOKEN}`;
const EXPIRES = new Date("2026-11-04T08:00:00Z");
const CASE = { clientName: "Cliente A", caseTitle: "Gestione richieste" };

function assertClean(mail: RenderedEmail): void {
  for (const banned of ["<img", "src=", "url(", "<script", "<link", "@import", "utm_", "?"]) {
    assert.ok(!mail.html.includes(banned), `html contains ${banned}`);
  }
  // Ogni link dell'HTML è esattamente uno dei link ammessi, senza parametri; l'unico frammento è quello del chiarimento.
  for (const m of mail.html.matchAll(/href="([^"]*)"/g)) {
    assert.ok(!m[1].includes("?"), m[1]);
    assert.ok(!m[1].includes("#") || /#\/chiarimento\/[0-9a-f-]{36}$/.test(m[1]), m[1]);
  }
  assert.ok(!/[\r\n]/.test(mail.subject));
  // (Rilascio 10, §3.12) L'oggetto al massimo di 55 caratteri, senza codice; il marchio una volta, senza piè di pagina.
  assert.ok(mail.subject.length <= EMAIL_SUBJECT_MAX, mail.subject);
  assert.doesNotMatch(mail.subject, /\b[A-Z]{2,4}-(?:UC-)?\d{2,4}\b/, mail.subject);
  assert.ok(!mail.text.includes(UC_EMAIL_SENDER_NAME), "niente piè di pagina con il marchio");
  // L'indirizzo in chiaro solo nel testo semplice: nell'HTML c'è solo come href.
  for (const m of mail.html.matchAll(/href="([^"]*)"/g)) assert.equal(mail.html.split(m[1]).length - 1, mail.html.split(`href="${m[1]}"`).length - 1, m[1]);
  assert.match(mail.html, /^<!doctype html><html lang="it">/);
}

/** (Rilascio 10, §3.12) Il corpo al massimo di 60 parole, senza il messaggio di chi chiede. */
function assertShort(mail: RenderedEmail): void {
  const words = emailBodyWords(mail.text);
  assert.ok(words <= EMAIL_BODY_MAX_WORDS, `${words} parole: ${mail.subject}\n${mail.text}`);
}

test("request email: subject with the count and the title, minutes in the text, link, expiry and privacy note", () => {
  const mail = renderEmail({ ...CASE, template: "richiesta_inviata", questions: 8, minutes: 15, expiresAt: EXPIRES, link: LINK, message: "Grazie!\nA presto" });
  assert.equal(mail.subject, "Cliente A: 8 domande su «Gestione richieste»");
  assert.ok(mail.text.includes("ci servono alcune informazioni da te: 8 domande, circa 15 minuti."));
  assert.ok(mail.text.includes(`Apri le domande: ${LINK}`));
  // (Rilascio 10, §3.12) La riga piccola del modello, come le email di «Chiedi al referente».
  assert.ok(mail.text.includes("Il link è solo tuo e vale fino al 4 novembre. Per un dubbio, rispondi qui."));
  assert.ok(mail.text.includes("Se non sai una cosa, scegli «Non lo so» o chiedi a un'altra persona."));
  assert.ok(mail.text.includes("> Grazie!\n> A presto"));
  assert.ok(mail.html.includes(`href="${LINK}"`));
  assertClean(mail);
  const one = renderEmail({ ...CASE, template: "richiesta_inviata", questions: 1, minutes: null, expiresAt: EXPIRES, link: LINK });
  assert.equal(one.subject, "Cliente A: 1 domanda su «Gestione richieste»");
  assertShort(one);
});

test("reminders: the second says it is the last one", () => {
  const first = renderEmail({ ...CASE, template: "promemoria_1", questions: 1, minutes: 2, expiresAt: EXPIRES, link: LINK });
  assert.equal(first.subject, "Cliente A: promemoria su «Gestione richieste»");
  assert.ok(first.text.includes("ti ricordiamo una domanda ancora aperta"));
  // (Rilascio 10, §3.12) Genere neutro e un solo «Riprendi».
  assert.ok(first.text.includes("Le risposte già scritte sono salvate: riprendi da lì."));
  assert.ok(first.text.includes(`Riprendi: ${LINK}`) && !first.text.includes("Riprendi le domande"));
  const second = renderEmail({ ...CASE, template: "promemoria_2", questions: 3, minutes: null, expiresAt: EXPIRES, link: LINK });
  assert.equal(second.subject, "Cliente A: ultimo promemoria su «Gestione richieste»");
  assert.ok(second.text.includes("È l'ultimo promemoria: se non sai qualcosa, scegli «Non lo so»."));
  assert.ok(second.text.includes("3 domande ancora aperte"));
  for (const mail of [first, second]) {
    assertClean(mail);
    assertShort(mail);
  }
});

test("Owner escalation lists the titles (never the keys), never answers or people, and has no link", () => {
  const items = Array.from({ length: 33 }, (_, i) => ({ key: `q.esempio.${String(i + 1).padStart(2, "0")}`, title: `Domanda ${i + 1}` }));
  const mail = renderEmail({ ...CASE, template: "segnalazione_owner", roleLabel: "Commerciale", items });
  assert.equal(mail.subject, "Cliente A: domande in attesa su «Gestione richieste»");
  assert.ok(mail.text.includes("33 domande per il ruolo «Commerciale» aspettano ancora una risposta, dopo due promemoria."));
  // (Rilascio 10, §3.12) Niente chiavi («richiesta.durata») a una persona del cliente: solo i titoli.
  assert.ok(mail.text.includes("- Domanda 1\n"));
  assert.ok(!mail.text.includes("q.esempio."));
  assert.ok(!mail.text.includes("Domanda 31"));
  assert.ok(mail.text.includes("E altre 3."));
  assert.ok(!mail.html.includes("href="));
  assertClean(mail);
});

test("clarification, delegation and approval emails", () => {
  const clar = renderEmail({ ...CASE, template: "chiarimento", itemTitle: "Tempo medio", expiresAt: EXPIRES, link: LINK });
  assert.equal(clar.subject, "Cliente A: un chiarimento su «Gestione richieste»");
  assert.ok(clar.text.includes(`Rispondi: ${LINK}`));
  assertClean(clar);
  const colleague = renderEmail({ ...CASE, template: "delega", audience: "collega", fromRoleLabel: "Operativo", questions: 2, minutes: 4, expiresAt: EXPIRES, link: LINK });
  assert.equal(colleague.subject, "Cliente A: 2 domande per te su «Gestione richieste»");
  // (Rilascio 10, §4) «un'altra persona», mai «un collega»: genere neutro.
  assert.ok(colleague.text.includes("una persona (Operativo) di Cliente A ti chiede"));
  assertClean(colleague);
  const delegator = renderEmail({ ...CASE, template: "delega", audience: "delegante", questions: 2 });
  assert.ok(!delegator.html.includes("href="));
  assert.equal(delegator.subject, "Cliente A: domande girate su «Gestione richieste»");
  assertClean(delegator);
  const approval = renderEmail({ ...CASE, template: "richiesta_approvazione", designation: "privacy", pending: 1, expiresAt: EXPIRES, link: LINK });
  // (Rilascio 10, §4) «Firma», come nella pagina.
  assert.equal(approval.subject, "Cliente A: da firmare «Gestione richieste»");
  assert.ok(approval.text.includes("responsabile della firma privacy") && approval.text.includes("aspetta la tua firma."));
  for (const mail of [clar, colleague, delegator, approval]) {
    assertClean(mail);
    assertShort(mail);
  }
});

test("weekly summary for the Owner and for Lateral Space", () => {
  const base = {
    code: "ES-UC-01",
    title: "Gestione richieste",
    total: 20,
    counts: { in_verifica: 4, da_chiedere: 14, mancante: 2 },
    greenPct: 0,
    g1: { required: 10, ok: 0 },
    redItems: [{ key: "q.esempio.03", title: "Volumi" }],
    nextMilestone: { title: "Fase 1", label: "entro novembre", isProposal: true, toConfirm: false },
  };
  const owner = renderEmail({ template: "riepilogo_settimanale", audience: "owner", clientName: "Cliente A", week: "2026-W41", cases: [base] });
  assert.equal(owner.subject, "Cliente A: riepilogo della settimana");
  // (Rilascio 10, §3.12) Una riga per caso d'uso, senza il muro degli stati né le chiavi.
  assert.ok(owner.text.includes("Gestione richieste — 0 % a posto · prossima tappa: Fase 1, entro novembre (proposta)"), owner.text);
  assert.ok(!owner.text.includes("% verde") && !owner.text.includes("voci obbligatorie"));
  assert.ok(owner.text.includes("Mancano ancora:\n\n- Volumi"));
  assert.ok(!owner.text.includes("q.esempio.03"), "never the keys");
  assert.ok(owner.text.includes("Per non riceverlo più, scrivi a Lateral Space."));
  assert.ok(!owner.html.includes("href="));
  assertClean(owner);
  const ls = renderEmail({
    template: "riepilogo_settimanale",
    audience: "ls",
    clientName: null,
    week: "2026-W41",
    cases: [{ ...base, link: "https://unbundle.example/dashboard/7c9e6679-7425-40de-944b-e07fc1f90ae7/casi-duso/16fd2706-8baf-433b-82eb-8c7fada847da" }],
  });
  // (Rilascio 10, §3.12) La settimana come la dice la campanella, mai il codice ISO; il pulsante con il verbo.
  assert.equal(ls.subject, "Riepilogo dei casi d'uso: settimana 41");
  assert.ok(ls.text.includes("ecco a che punto sono i casi d'uso (settimana 41)."), ls.text);
  assert.ok(owner.text.includes("ecco a che punto sono i casi d'uso (settimana 41)."), owner.text);
  assert.ok(!ls.text.includes("2026-W41") && !owner.text.includes("2026-W41"));
  assert.ok(!ls.text.includes("Volumi"), "red items only for the Owner");
  assert.ok(ls.text.includes("Apri la realizzazione: https://unbundle.example/dashboard/"));
  assert.ok(!ls.text.includes("Apri ES-UC-01"), "never the code on the button");
  assert.ok(ls.html.includes('href="https://unbundle.example/dashboard/'));
  assertClean(ls);
});

test("(rilascio 10, §3.12) weekly summary: the client opens the subject for Lateral Space too; an unreadable week says «questa settimana»", () => {
  const cases = [{ code: "XX-0012", title: "Gestione richieste", total: 20, counts: {}, greenPct: 45, g1: null, nextMilestone: null, link: "https://unbundle.example/dashboard/7c9e6679-7425-40de-944b-e07fc1f90ae7/casi-duso/16fd2706-8baf-433b-82eb-8c7fada847da" }];
  const ls = renderEmail({ template: "riepilogo_settimanale", audience: "ls", clientName: "Cliente Demo", week: "2026-W47", cases });
  assert.equal(ls.subject, "Cliente Demo: riepilogo della settimana");
  assert.ok(ls.text.includes("Gestione richieste — 45 % a posto\n"), ls.text);
  const odd = renderEmail({ template: "riepilogo_settimanale", audience: "ls", clientName: null, week: "settimana?", cases });
  assert.equal(odd.subject, "Riepilogo dei casi d'uso: questa settimana");
  assert.ok(odd.text.includes("ecco a che punto sono i casi d'uso questa settimana."), odd.text);
  for (const mail of [ls, odd]) {
    assert.doesNotMatch(`${mail.subject}\n${mail.text}`, /\bW\d{2}\b|XX-0012/);
    assertClean(mail);
  }
});

// ── (9b) The «Contesto» block of the weekly summary (RILASCIO-9b-COSTRUZIONE.md §2.9, D6) ──

const WS_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const CONTEXT_LINK = `https://unbundle.example/dashboard/${WS_ID}/contesto`;
const WEEK_CASE = {
  code: "XX-0012",
  title: "Gestione richieste",
  total: 20,
  counts: { in_verifica: 4, da_chiedere: 16 },
  greenPct: 0,
  g1: null,
  nextMilestone: null,
};
const LS_WEEK = {
  template: "riepilogo_settimanale",
  audience: "ls",
  clientName: null,
  week: "2026-W47",
  cases: [{ ...WEEK_CASE, link: `https://unbundle.example/dashboard/${WS_ID}/casi-duso/16fd2706-8baf-433b-82eb-8c7fada847da` }],
} as const;
const OWNER_WEEK = { template: "riepilogo_settimanale", audience: "owner", clientName: "Cliente A", week: "2026-W47", cases: [{ ...WEEK_CASE, redItems: [] }] } as const;
const ZERO_LS = { novelties: 0, toConfirm: 0, toCheck: 0, due: { ours: 0, theirs: 0 }, link: CONTEXT_LINK };

/** The block in the plain text: from its first title to the closing line of the e-mail. */
function blockOf(mail: RenderedEmail, first: string, closing: string): string {
  const start = mail.text.indexOf(first);
  const end = mail.text.indexOf(closing);
  assert.ok(start > 0 && end > start, `${first} … ${closing}`);
  return mail.text.slice(start, end).trim();
}

test("(9b) weekly summary for Lateral Space: «Contesto del cliente» after the cases and before the closing, numbers only, with the link", () => {
  const mail = renderEmail({ ...LS_WEEK, context: { novelties: 4, toConfirm: 12, toCheck: 3, due: { ours: 2, theirs: 1 }, link: CONTEXT_LINK } });
  assert.equal(
    blockOf(mail, "Contesto del cliente:", "Riepilogo interno di Lateral Space."),
    [
      "Contesto del cliente:",
      "",
      "- 4 novità questa settimana\n- 12 proposte da confermare\n- 3 fatti da verificare (fermi da più di 6 mesi)\n- Impegni in scadenza: 2 nostri, 1 del cliente",
      "",
      `Apri il contesto: ${CONTEXT_LINK}`,
    ].join("\n"),
  );
  assert.ok(mail.text.indexOf("Gestione richieste — ") < mail.text.indexOf("Contesto del cliente:"), "after the cases");
  assert.ok(mail.html.includes(`href="${CONTEXT_LINK}"`));
  assertClean(mail);
  // The subject does not change.
  assert.equal(mail.subject, "Riepilogo dei casi d'uso: settimana 47");
});

test("(9b) weekly summary: one line per number that is not zero, with the singulars of the plan", () => {
  const one = renderEmail({ ...LS_WEEK, context: { novelties: 1, toConfirm: 1, toCheck: 1, due: { ours: 1, theirs: 1 }, link: CONTEXT_LINK } });
  assert.ok(
    one.text.includes("- 1 novità questa settimana\n- 1 proposta da confermare\n- 1 fatto da verificare (fermo da più di 6 mesi)\n- Impegni in scadenza: 1 nostro, 1 del cliente"),
    one.text,
  );
  const some = renderEmail({ ...LS_WEEK, context: { ...ZERO_LS, toCheck: 2, due: { ours: 3, theirs: 0 } } });
  assert.ok(some.text.includes("Contesto del cliente:\n\n- 2 fatti da verificare (fermi da più di 6 mesi)\n- Impegni in scadenza: 3 nostri\n\nApri il contesto:"), some.text);
  assert.ok(!some.text.includes("novità") && !some.text.includes("proposte"));
  const theirs = renderEmail({ ...LS_WEEK, context: { ...ZERO_LS, due: { ours: 0, theirs: 2 } } });
  assert.ok(theirs.text.includes("- Impegni in scadenza: 2 del cliente\n"), theirs.text);
  const owner = renderEmail({ ...OWNER_WEEK, context: { novelties: 1, commitments: [], today: "2026-11-16" } });
  assert.ok(owner.text.includes("Che cosa sappiamo del vostro lavoro:\n\n- 1 fatto nuovo o aggiornato questa settimana\n"), owner.text);
  assert.ok(!owner.text.includes("Impegni del vostro team"), "a title only with its lines");
});

test("(9b) weekly summary: all zeros, no block; the e-mail is the one of before, byte for byte", () => {
  const lsBefore = renderEmail(LS_WEEK);
  const ownerBefore = renderEmail(OWNER_WEEK);
  for (const context of [ZERO_LS, null, undefined]) assert.deepEqual(renderEmail({ ...LS_WEEK, context }), lsBefore);
  for (const context of [{ novelties: 0, commitments: [], today: "2026-11-16" }, null, undefined]) assert.deepEqual(renderEmail({ ...OWNER_WEEK, context }), ownerBefore);
  assert.ok(!lsBefore.text.includes("Contesto del cliente") && !ownerBefore.text.includes("Che cosa sappiamo"));
});

test("(9b) weekly summary for the Owner: the novelties and at most three commitments of the client, with the date, and no link", () => {
  const mail = renderEmail({
    ...OWNER_WEEK,
    context: {
      novelties: 4,
      commitments: [
        { statement: "Mandare l'organigramma aggiornato", dueOn: "2026-11-11" },
        { statement: "Inviare l'esportazione delle fatture", dueOn: "2026-11-25" },
        { statement: "Confermare la data del collaudo", dueOn: "2027-01-08" },
        { statement: "Indicare chi approva gli acquisti", dueOn: "2026-11-20" },
      ],
      today: "2026-11-16",
    },
  });
  assert.equal(
    blockOf(mail, "Che cosa sappiamo del vostro lavoro:", "Per non riceverlo più"),
    [
      "Che cosa sappiamo del vostro lavoro:",
      "",
      "- 4 fatti nuovi o aggiornati questa settimana",
      "",
      "Impegni del vostro team in scadenza:",
      "",
      "- Mandare l'organigramma aggiornato · scaduto l'11 nov\n- Inviare l'esportazione delle fatture · entro il 25 nov\n- Confermare la data del collaudo · entro l'8 gen 2027",
    ].join("\n"),
  );
  assert.ok(!mail.text.includes("approva gli acquisti"), "at most three");
  assert.ok(mail.text.indexOf("Gestione richieste — ") < mail.text.indexOf("Che cosa sappiamo del vostro lavoro:"), "after the cases");
  assert.ok(!mail.html.includes("href="), "no link for the Owner");
  assertClean(mail);
  // Only commitments: the second title alone. A commitment without a valid date is left out.
  const only = renderEmail({ ...OWNER_WEEK, context: { novelties: 0, commitments: [{ statement: "Inviare le fatture", dueOn: "2026-11-31" }, { statement: "Mandare il listino", dueOn: "2026-11-01" }], today: "2026-11-16" } });
  assert.ok(only.text.includes("Impegni del vostro team in scadenza:\n\n- Mandare il listino · scaduto l'1 nov\n"), only.text);
  assert.ok(!only.text.includes("Che cosa sappiamo") && !only.text.includes("Inviare le fatture"));
});

test("(9b) the «Contesto» block has no names and never says «use case»; the Owner's block passes the copy-guard", () => {
  const ls = blockOf(
    renderEmail({ ...LS_WEEK, context: { novelties: 4, toConfirm: 12, toCheck: 3, due: { ours: 2, theirs: 1 }, link: CONTEXT_LINK } }),
    "Contesto del cliente:",
    "Riepilogo interno di Lateral Space.",
  );
  const owner = blockOf(
    renderEmail({ ...OWNER_WEEK, context: { novelties: 4, commitments: [{ statement: "Inviare l'esportazione delle fatture", dueOn: "2026-11-25" }], today: "2026-11-16" } }),
    "Che cosa sappiamo del vostro lavoro:",
    "Per non riceverlo più",
  );
  for (const block of [ls, owner]) {
    assert.doesNotMatch(block, /use[\s-]?case/i);
    assert.deepEqual(scanPersonalData(block.replace(CONTEXT_LINK, "")), { ok: true }, block);
  }
  assert.deepEqual(findForbidden(owner, "cliente"), []);
});

test("(9b) the link to «Contesto»: /dashboard/<ws>/contesto and nothing under it", () => {
  assert.equal(checkEmailLink(CONTEXT_LINK, "dashboard"), CONTEXT_LINK);
  assert.equal(checkEmailLink(`http://127.0.0.1:53110/dashboard/${WS_ID}/contesto`, "dashboard"), `http://127.0.0.1:53110/dashboard/${WS_ID}/contesto`);
  for (const bad of [
    `${CONTEXT_LINK}/verifica`,
    `${CONTEXT_LINK}/qualcosa`,
    `${CONTEXT_LINK}?vista=appunti`,
    `${CONTEXT_LINK}#novita`,
    "https://unbundle.example/contesto/qualcosa",
    "https://unbundle.example/contesto",
    `https://unbundle.example/dashboard/${WS_ID}/contesto-altro`,
    `http://unbundle.example/dashboard/${WS_ID}/contesto`,
  ]) {
    assert.throws(() => checkEmailLink(bad, "dashboard"), bad);
  }
  assert.throws(() => checkEmailLink(CONTEXT_LINK, "referente"), "never a referent link");
  assert.throws(() => renderEmail({ ...LS_WEEK, context: { ...ZERO_LS, toConfirm: 1, link: `${CONTEXT_LINK}/conferma` } }), "a wrong link never leaves");
});

test("links must be clean https links to the expected path", () => {
  assert.equal(checkEmailLink(LINK, "referente"), LINK);
  assert.equal(checkEmailLink(`http://127.0.0.1:53110/r/${TOKEN}`, "referente"), `http://127.0.0.1:53110/r/${TOKEN}`);
  for (const bad of [
    `http://unbundle.example/r/${TOKEN}`,
    `${LINK}?utm_source=x`,
    `${LINK}#x`,
    `https://user:pw@unbundle.example/r/${TOKEN}`,
    "https://unbundle.example/r/ucr_short",
    "https://unbundle.example/altro",
    "javascript:alert(1)",
    "non un link",
  ]) {
    assert.throws(() => checkEmailLink(bad, "referente"), bad);
  }
  assert.throws(() => renderEmail({ ...CASE, template: "chiarimento", itemTitle: null, expiresAt: EXPIRES, link: "https://x.example/r/abc" }));
});

test("user-provided text is escaped and kept on one line where it must be", () => {
  const input: EmailInput = {
    clientName: "Cliente <b>A</b>\r\nBcc: x@y.z",
    caseTitle: "Caso \"uno\" & 'due'",
    template: "richiesta_inviata",
    questions: 2,
    minutes: 3,
    expiresAt: EXPIRES,
    link: LINK,
    message: "<script>alert(1)</script>",
  };
  const mail = renderEmail(input);
  assert.ok(!mail.subject.includes("\n"));
  assert.ok(mail.subject.startsWith("Cliente <b>A</b> Bcc: x"), "the subject is plain text, one line");
  assert.ok(mail.subject.length <= 55, mail.subject);
  assert.ok(mail.html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.ok(mail.html.includes("Caso &quot;uno&quot; &amp; &#39;due&#39;"));
  assert.ok(!mail.html.includes("<script"));
  assert.equal(escapeHtml(`<a href="x">'&`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;");
  assert.equal(formatDateIt(new Date("2026-12-31T23:30:00Z")), "1 gennaio 2027", "dates are in Rome time");
});

test("clarification email opens the clarification itself (R8); nothing else in the fragment", () => {
  const ITEM = "16fd2706-8baf-433b-82eb-8c7fada847da";
  assert.equal(clarificationLink(LINK, ITEM.toUpperCase()), `${LINK}#/chiarimento/${ITEM}`);
  assert.equal(clarificationLink(LINK, "not-an-id"), LINK);
  assert.equal(clarificationLink(LINK, null), LINK);
  const mail = renderEmail({ ...CASE, template: "chiarimento", itemTitle: "Tempo medio", expiresAt: EXPIRES, link: LINK, itemId: ITEM });
  assert.ok(mail.html.includes(`href="${LINK}#/chiarimento/${ITEM}"`));
  assertClean(mail);
});

test("every email to a referent or a link signer passes the copy-guard", () => {
  const mails: RenderedEmail[] = [
    renderEmail({ ...CASE, template: "richiesta_inviata", questions: 8, minutes: 15, expiresAt: EXPIRES, link: LINK, message: "Grazie!" }),
    renderEmail({ ...CASE, template: "promemoria_1", questions: 3, minutes: 4, expiresAt: EXPIRES, link: LINK }),
    renderEmail({ ...CASE, template: "promemoria_2", questions: 3, minutes: 4, expiresAt: EXPIRES, link: LINK }),
    renderEmail({ ...CASE, template: "chiarimento", itemTitle: "Volumi del mese", expiresAt: EXPIRES, link: LINK }),
    renderEmail({ ...CASE, template: "delega", audience: "collega", fromRoleLabel: "Operativo", questions: 2, minutes: 4, expiresAt: EXPIRES, link: LINK }),
    renderEmail({ ...CASE, template: "delega", audience: "delegante", questions: 2 }),
    renderEmail({ ...CASE, template: "richiesta_approvazione", designation: "owner", pending: 2, expiresAt: EXPIRES, link: LINK }),
    renderEmail({ ...CASE, template: "richiesta_approvazione", designation: "privacy", pending: 1, expiresAt: EXPIRES, link: LINK }),
  ];
  for (const mail of mails) {
    // Il token del link è una stringa casuale, non un testo: si controlla il resto.
    const text = `${mail.subject}\n${mail.text}`.replaceAll(TOKEN, "");
    assert.deepEqual(findForbidden(text, "cliente"), [], mail.subject);
  }
  assert.ok(mails[6].text.includes("come responsabile del cliente"), "the client's role in the words of the page, not «Owner»");
});

test("(rilascio 10, §3.12) le email della realizzazione hanno l'intestazione come le altre: il marchio una volta, in cima", () => {
  const brand = emailBrand("https://www.theunbundle.com");
  const mail = renderEmail({ ...CASE, template: "richiesta_inviata", questions: 2, minutes: 4, expiresAt: EXPIRES, link: LINK }, brand);
  const imgs = mail.html.match(/<img\b[^>]*>/g) ?? [];
  assert.equal(imgs.length, 1);
  assert.match(imgs[0], /src="https:\/\/www\.theunbundle\.com\/email\/unbundle-u\.png"/);
  assert.ok(mail.html.indexOf("<img") < mail.html.indexOf("Buongiorno,"));
  assert.ok(!mail.html.includes("Lateral Space via Unbundle"), "il marchio non si ripete in fondo");
  assert.deepEqual(renderEmail({ ...CASE, template: "richiesta_inviata", questions: 2, minutes: 4, expiresAt: EXPIRES, link: LINK }).text, mail.text, "il testo semplice è lo stesso");
});
