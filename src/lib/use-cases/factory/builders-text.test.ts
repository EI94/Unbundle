import test from "node:test";
import assert from "node:assert/strict";
import {
  BLOCKED_CANDIDATE_NOTE,
  builderCandidateGroups,
  builderStateText,
  builderWhereText,
  EXTERNAL_ROLE_HINT,
  externalAddedText,
  externalRemoveConfirm,
  externalRemovedText,
  lsAddedText,
  lsRemovedText,
  SKIP_REASON,
} from "./builders-text.ts";

// I testi di «Chi costruisce» (rilascio 8.0c, RILASCIO-8.0c-ESTERNI.md §11).

const ALL = { all: true } as const;
const codes = (n: number, from = 1) => Array.from({ length: n }, (_, i) => `NM-${String(from + i).padStart(4, "0")}`);

test("«Aggiungi» in tutti i casi: quanti, i nuovi, il repository da aprire su GitHub", () => {
  assert.equal(
    externalAddedText({ where: ALL, entered: codes(22), already: [], left: [], skipped: [], repos: ["Voltaen/alfa-esploso"], released: 0 }),
    "Costruisce in 22 casi ed entrerà in quelli nuovi. Su GitHub dagli la scrittura su Voltaen/alfa-esploso.",
  );
  assert.equal(
    externalAddedText({ where: ALL, entered: [], already: [], left: [], skipped: [], repos: [], released: 0 }),
    "Nessun caso aperto ancora: entrerà in ognuno appena lo avvii. I repository dei casi non ci sono ancora: quando li crei, dagli la scrittura.",
  );
  assert.equal(
    externalAddedText({ where: { all: false, useCaseIds: ["a"] }, entered: ["NM-0009"], already: [], left: [], skipped: [], repos: [], released: 0 }),
    "Costruisce in 1 caso. I repository dei casi non ci sono ancora: quando li crei, dagli la scrittura.",
  );
});

test("«Aggiungi»: i casi saltati con il motivo, e quelli da cui esce cambiando il «Dove»", () => {
  const text = externalAddedText({
    where: ALL,
    entered: codes(20),
    already: [],
    left: [],
    skipped: [
      { code: "NM-0009", reason: "ruolo_cliente" },
      { code: "NM-0010", reason: "attore_non_ammesso" },
    ],
    repos: ["Voltaen/alfa-esploso"],
    released: 0,
  });
  assert.match(text, / Saltati: NM-0009 \(lì firma o approva per il cliente\), NM-0010 \(lì non sei responsabile\)\.$/);
  const narrowed = externalAddedText({ where: { all: false, useCaseIds: ["a"] }, entered: [], already: ["NM-0001"], left: ["NM-0002", "NM-0003"], skipped: [], repos: [], released: 2 });
  assert.match(narrowed, /^Costruisce in 1 caso\. Esce da 2 casi: i compiti che aveva lì tornano da prendere\./);
});

test("«Aggiungi» con ogni caso aperto saltato: non dice «nessun caso aperto», dice che per ora non costruisce e perché", () => {
  const skipped = [
    { code: "ES-0001", reason: "attore_non_ammesso" },
    { code: "XX-0012", reason: "ruolo_cliente" },
  ];
  assert.equal(
    externalAddedText({ where: ALL, entered: [], already: [], left: [], skipped, repos: ["Voltaen/prova-esterni"], released: 0 }),
    "Per ora non costruisce in nessun caso aperto: entrerà in quelli nuovi. Su GitHub dagli la scrittura su Voltaen/prova-esterni. Saltati: ES-0001 (lì non sei responsabile), XX-0012 (lì firma o approva per il cliente).",
  );
  assert.match(
    externalAddedText({ where: { all: false, useCaseIds: ["a"] }, entered: [], already: [], left: [], skipped: skipped.slice(0, 1), repos: [], released: 0 }),
    /^Per ora non costruisce in nessuno dei casi scelti\. .* Saltati: ES-0001 \(lì non sei responsabile\)\.$/,
  );
  // Senza casi aperti (niente di saltato): come prima.
  assert.match(externalAddedText({ where: { all: false, useCaseIds: ["a"] }, entered: [], already: [], left: [], skipped: [], repos: [], released: 0 }), /^Nessuno dei casi scelti è aperto ancora: entrerà in ognuno appena lo avvii\./);
});

test("«Togli» di chi non è in nessun dossier: la conferma e il messaggio dopo non dicono «0 casi»", () => {
  assert.deepEqual(externalRemoveConfirm({ name: "Prova Esterno", openCases: 0, repos: [] }), {
    title: "Togliere Prova Esterno da chi costruisce?",
    text: "Da subito non scrive più nei casi del cliente e non entra in quelli nuovi.",
  });
  assert.equal(externalRemovedText({ left: [], skipped: [], repos: [] }), "Non costruisce più. Ricorda la sua chiave dell'AI Gateway.");
});

test("«Togli»: la conferma con i casi e i repository, e il messaggio dopo", () => {
  assert.deepEqual(externalRemoveConfirm({ name: "Sandro Neri", openCases: 22, repos: ["Voltaen/alfa-esploso"] }), {
    title: "Togliere Sandro Neri da chi costruisce?",
    text: "Da subito non scrive più nei casi del cliente e non entra in quelli nuovi. Esce da 22 casi e i compiti che ha in corso tornano da prendere. Su GitHub togli anche il suo accesso a Voltaen/alfa-esploso.",
  });
  assert.equal(
    externalRemovedText({ left: codes(22), skipped: [], repos: ["Voltaen/alfa-esploso"] }),
    "Non costruisce più: esce da 22 casi. Ricorda GitHub (Voltaen/alfa-esploso) e la sua chiave dell'AI Gateway.",
  );
  assert.match(externalRemovedText({ left: [], skipped: [{ code: "NM-0010", reason: "attore_non_ammesso" }], repos: [] }), /In NM-0010 resta nella realizzazione da osservatore, senza poteri: lì non sei responsabile\.$/);
});

test("la riga: «CLI collegata», «CLI da collegare», o perché da fuori oggi non costruisce; dove", () => {
  assert.equal(builderStateText({ cli: true, blocked: null }), "CLI collegata");
  assert.equal(builderStateText({ cli: false, blocked: null }), "CLI da collegare");
  assert.equal(builderStateText({ cli: true, blocked: "ruolo_workspace" }), "non costruisce: serve il ruolo di Analista");
  assert.equal(builderStateText({ cli: false, blocked: "email_non_verificata" }), "non costruisce: serve l'e-mail verificata");
  assert.equal(builderWhereText(ALL, []), "tutti i casi");
  assert.equal(builderWhereText({ all: false, useCaseIds: ["a", "b", "c", "d"] }, codes(4)), "NM-0001, NM-0002, NM-0003 e altri 1");
});

test("Lateral Space: «Aggiungi» e «Togli» dicono dove entra ed esce, senza dire il genere della persona", () => {
  assert.equal(
    lsAddedText({ done: codes(3), unchanged: codes(1, 4), skipped: [{ code: "NM-0010", reason: "attore_non_ammesso" }] }),
    "Nel team del cliente: entrerà anche nei casi nuovi. Entra in 3 casi, c'era già in 1 caso. Saltati: NM-0010 (lì non sei responsabile). Si cambia dal team della realizzazione.",
  );
  assert.equal(lsRemovedText({ done: codes(2), skipped: [], released: 1 }), "Fuori dal team del cliente: esce da 2 casi e non entra nei casi nuovi. I compiti che aveva lì tornano da prendere (1).");
});

test("i testi di «Chi costruisce» non dicono il genere della persona: niente «uscita», «aggiunta», «tolta», «uno sviluppatore», «un collaboratore»", () => {
  const ALL_SKIPS = Object.keys(SKIP_REASON).map((reason, i) => ({ code: `NM-00${10 + i}`, reason }));
  const texts = [
    EXTERNAL_ROLE_HINT,
    ...Object.values(SKIP_REASON),
    externalAddedText({ where: ALL, entered: codes(2), already: [], left: codes(2, 5), skipped: ALL_SKIPS, repos: ["Voltaen/alfa-esploso"], released: 1 }),
    externalAddedText({ where: ALL, entered: [], already: [], left: [], skipped: ALL_SKIPS, repos: [], released: 0 }),
    externalRemovedText({ left: codes(3), skipped: ALL_SKIPS, repos: ["Voltaen/alfa-esploso"] }),
    externalRemoveConfirm({ name: "Prova Esterno", openCases: 3, repos: ["Voltaen/alfa-esploso"] }).text,
    lsAddedText({ done: codes(1), unchanged: codes(1), skipped: ALL_SKIPS }),
    lsRemovedText({ done: codes(1), skipped: ALL_SKIPS, released: 2 }),
    ...["ruolo_workspace", "email_non_verificata", "di_lateral_space", null].flatMap((blocked) => [builderStateText({ cli: true, blocked }), builderStateText({ cli: false, blocked })]),
  ];
  for (const text of texts) {
    // «CLI collegata» e «e-mail verificata» dicono la CLI e l'e-mail, non la persona.
    assert.doesNotMatch(text, /\b(uscit|aggiunt|tolt|entrat|invitat)[ao]\b/i, text);
    assert.doesNotMatch(text, /\b(uno sviluppatore|un collaboratore|collaboratore del|osservatrice)\b/i, text);
  }
});

test("«Persona»: chi da fuori oggi «Aggiungi» rifiuterebbe c'è, ma spento, con il perché; Lateral Space e gli esterni che possono costruire si scelgono", () => {
  const groups = builderCandidateGroups([
    { userId: "c", name: "Carla Contributore", isLateralSpace: false, blocked: "ruolo_workspace" },
    { userId: "e", name: "Ettore Esterno", isLateralSpace: false, blocked: null },
    { userId: "u", name: "Ugo Da Verificare", isLateralSpace: false, blocked: "email_non_verificata" },
    { userId: "l", name: "Leo Lateral", isLateralSpace: true, blocked: null },
  ]);
  assert.deepEqual(groups, [
    { label: "Lateral Space", options: [{ value: "l", label: "Leo Lateral" }] },
    {
      label: "Esterni",
      options: [
        { value: "c", label: "Carla Contributore", disabled: true, note: "serve il ruolo di Analista" },
        { value: "e", label: "Ettore Esterno" },
        { value: "u", label: "Ugo Da Verificare", disabled: true, note: "serve l'e-mail verificata" },
      ],
    },
  ]);
  assert.deepEqual(builderCandidateGroups([{ userId: "x", name: "Xenia", isLateralSpace: false, blocked: "altro" }])[0].options[0].note, "non può costruire");
  assert.deepEqual(Object.keys(BLOCKED_CANDIDATE_NOTE).sort(), ["di_lateral_space", "email_non_verificata", "non_collaboratore", "ruolo_workspace"]);
});
