import test from "node:test";
import assert from "node:assert/strict";
import { CONTEXT_TEXT } from "../../lib/context/text.ts";
import type { CommitmentView, FactView, MemorySection, MemoryView } from "../../lib/db/queries/context-memory.ts";
import type { OpenProposals, ProposalView } from "../../lib/db/queries/context-proposals.ts";
import type { UseCaseContext, UseCaseFact } from "../../lib/db/queries/context-work.ts";
import type { SourceListItem } from "../../lib/db/queries/context-sources.ts";
import {
  addNotesClose,
  afterConfirm,
  afterUpload,
  askSourceMeta,
  briefMaterial,
  CASE_NOVELTIES_MAX,
  chunkItems,
  confirmCount,
  confirmGroups,
  confirmSubtitle,
  consentNoticeNeeded,
  CONTEXT_PACKAGE_FILE,
  contextCommitmentGroups,
  contextFactGroups,
  contextFoldNovelties,
  contextFoldShown,
  contextFoldSummary,
  droppedFileKind,
  droppedText,
  dueText,
  editableFields,
  factMarks,
  fileExtension,
  fileSizeText,
  fileTypeText,
  initialSelection,
  initialVerifyChoice,
  isCheckable,
  isMemoryEmpty,
  answersNeedLine,
  needLinkText,
  noteDraftErrors,
  notReportedLines,
  noveltyTag,
  packageDeltaLine,
  packageFilesShown,
  proposalDraft,
  proposalPatch,
  proposalSource,
  proposalSourceLabel,
  proposedTitle,
  readOutcomeMessage,
  reconfirmable,
  reconfirmationsToChoose,
  responseMessage,
  rowErrors,
  sectionLabel,
  selectedItems,
  selectionFrom,
  sourceMeta,
  sourceOriginLabel,
  sourceReadAction,
  sourceStateLabel,
  titleFromFileName,
  toCheckMeta,
  toCheckRow,
  uploadableDocument,
  verifyButtonLabel,
  verifyChosen,
  visibilityLabel,
  visibleSections,
} from "./view-model.ts";

// Le regole della pagina «Contesto» (rilascio 9a, RILASCIO-9a-COSTRUZIONE.md §7, §11.3): i gruppi di «Da confermare» e
// il loro ordine, la preselezione, il conto di «Conferma (n)», i conflitti senza scelta, le etichette di stato e di
// fonte, le sezioni vuote saltate, «Aggiungi appunti». (9b, RILASCIO-9b-COSTRUZIONE.md §5.2) La piega «Contesto» (il
// riassunto, i singolari, assente senza contenuto), la riga di «Cosa serve», il dossier, «Da verificare».

const T = CONTEXT_TEXT;
const TODAY = "2026-11-16";

let next = 0;
function proposal(over: Partial<ProposalView> = {}): ProposalView {
  next += 1;
  return {
    id: `00000000-0000-4000-8000-${String(next).padStart(12, "0")}`,
    version: 1,
    sourceId: "s1",
    kind: "nuovo",
    statement: `Frase ${next}`,
    quote: null,
    basis: "detto",
    section: "azienda",
    visibility: "tutti",
    preselected: true,
    issue: null,
    issueMessage: null,
    before: null,
    useCases: [],
    party: null,
    roleLabel: null,
    dueOn: null,
    closesQuestion: null,
    ...over,
  };
}

function open(proposals: ProposalView[], reconfirmed: ProposalView[] = [], sources: OpenProposals["sources"] = []): OpenProposals {
  return { sources, proposals, reconfirmed };
}

// ─── «Da confermare» ─────────────────────────────────────────────────

test("i gruppi di «Da confermare» stanno nell'ordine fisso, solo quelli con righe; le riconferme non sono un gruppo", () => {
  const items = [
    proposal({ kind: "domanda", section: null, preselected: true }),
    proposal({ kind: "conflitto", preselected: false }),
    proposal({ kind: "decisione" }),
    proposal({ kind: "impegno", section: null, party: "nostra" }),
    proposal({ kind: "nuovo" }),
    proposal({ kind: "conferma" }),
  ];
  const groups = confirmGroups(items);
  assert.deepEqual(
    groups.map((g) => [g.key, g.label, g.items.map((p) => p.kind)]),
    [
      ["nuovi", T.confirm.groupNew, ["decisione", "nuovo"]],
      ["conflitti", T.confirm.groupConflicts, ["conflitto"]],
      ["impegni", T.confirm.groupCommitments, ["impegno"]],
      ["domande", T.confirm.groupQuestions, ["domanda"]],
    ],
  );
  assert.deepEqual(confirmGroups([proposal({ kind: "cambia" })]).map((g) => g.label), [T.confirm.groupChanged]);
  assert.deepEqual(confirmGroups([]), []);
});

test("preselezione: spuntate le «detto»; «dedotto», conflitti e proposte da correggere mai; le riconferme sì", () => {
  const said = proposal();
  const inferred = proposal({ basis: "dedotto", preselected: false });
  const conflict = proposal({ kind: "conflitto", preselected: false });
  const named = proposal({ issue: "nome_persona", issueMessage: "Non scrivere nomi", preselected: false });
  // Anche se la proposta arrivasse con `preselected` vero, un conflitto o un `issue` non si spuntano.
  const forcedConflict = proposal({ kind: "conflitto", preselected: true });
  const forcedIssue = proposal({ issue: "lungo", preselected: true });
  const selection = initialSelection(open([said, inferred, conflict, named, forcedConflict, forcedIssue]));
  assert.equal(selection.checked[said.id], true);
  for (const p of [inferred, conflict, named, forcedConflict, forcedIssue]) assert.equal(selection.checked[p.id], false, p.kind);
  assert.equal(selection.reconfirm, true);
  assert.deepEqual(selection.resolutions, {}, "nessun conflitto ha una scelta di partenza");
  assert.equal(isCheckable(conflict), false);
  assert.equal(isCheckable(named), false);
  assert.equal(isCheckable(inferred), true, "una «dedotto» si spunta a mano");
});

test("«Conferma (n)»: le righe spuntate, i conflitti con una scelta, le riconferme se la riga è spuntata", () => {
  const said = proposal();
  const inferred = proposal({ basis: "dedotto", preselected: false });
  const conflict = proposal({ kind: "conflitto", preselected: false, version: 3 });
  const named = proposal({ issue: "nome_persona", preselected: false });
  const again = [proposal({ kind: "conferma" }), proposal({ kind: "conferma" }), proposal({ kind: "conferma", issue: "lungo" })];
  const data = open([said, inferred, conflict, named], again);
  const start = initialSelection(data);
  // Partenza: la «detto» e le due riconferme senza problemi. Il conflitto senza scelta non conta.
  assert.equal(confirmCount(data, start), 3);
  assert.deepEqual(reconfirmable(data).length, 2);
  // Una proposta da correggere non entra nemmeno se qualcuno la spunta.
  const forced = { ...start, checked: { ...start.checked, [named.id]: true, [inferred.id]: true } };
  assert.equal(confirmCount(data, forced), 4);
  // Il conflitto entra solo con una scelta, e porta la scelta.
  const chosen = { ...forced, resolutions: { [conflict.id]: "ora" as const } };
  const items = selectedItems(data, chosen);
  assert.equal(items.length, 5);
  assert.deepEqual(
    items.find((item) => item.id === conflict.id),
    { id: conflict.id, version: 3, resolution: "ora" },
  );
  assert.equal(items.some((item) => item.id === named.id), false);
  // La riga delle riconferme tolta: restano le altre.
  assert.equal(confirmCount(data, { ...chosen, reconfirm: false }), 3);
  // Niente spuntato, nessuna scelta, riconferme tolte: zero (il pulsante è spento).
  assert.equal(confirmCount(data, { checked: {}, resolutions: {}, reconfirm: false }), 0);
});

test("riconferme: solo le «detto» partono spuntate, nella riga; le «dedotto» si scelgono una per una, come nell'MCP", () => {
  const said = proposal({ kind: "conferma" });
  const inferred = proposal({ kind: "conferma", basis: "dedotto", preselected: false });
  const fromClient = proposal({ kind: "conferma", preselected: false });
  const data = open([], [said, inferred, fromClient]);
  assert.deepEqual(reconfirmable(data).map((p) => p.id), [said.id]);
  assert.deepEqual(reconfirmationsToChoose(data).map((p) => p.id), [inferred.id, fromClient.id]);
  const start = initialSelection(data);
  assert.deepEqual([start.reconfirm, start.checked[inferred.id], start.checked[fromClient.id]], [true, false, false]);
  assert.deepEqual(selectedItems(data, start), [{ id: said.id, version: 1 }]);
  // Spuntata a mano, la «dedotto» entra; la riga tolta, le «detto» no.
  const picked = selectionFrom(data, { overrides: { [inferred.id]: true }, resolutions: {}, reconfirm: false });
  assert.deepEqual(selectedItems(data, picked), [{ id: inferred.id, version: 1 }]);
  assert.equal(confirmCount(data, selectionFrom(data, { overrides: { [inferred.id]: true }, resolutions: {}, reconfirm: true })), 2);
});

test("le scelte a mano restano sopra le proposte del server: una correzione o un aggiornamento non le cancellano", () => {
  const named = proposal({ issue: "nome_persona", preselected: false });
  const said = proposal();
  const inferred = proposal({ basis: "dedotto", preselected: false });
  const choices = { overrides: { [said.id]: false, [inferred.id]: true, [named.id]: true }, resolutions: {}, reconfirm: true };
  // Da correggere: non si spunta, anche se la persona l'aveva spuntata.
  let selection = selectionFrom(open([named, said, inferred]), choices);
  assert.deepEqual([selection.checked[named.id], selection.checked[said.id], selection.checked[inferred.id]], [false, false, true]);
  // Il server rimanda la proposta corretta (versione nuova, senza problema): torna come l'aveva messa la persona.
  const fixed = { ...named, version: 2, issue: null, issueMessage: null, preselected: true };
  selection = selectionFrom(open([fixed, said, inferred]), choices);
  assert.deepEqual([selection.checked[named.id], selection.checked[said.id], selection.checked[inferred.id]], [true, false, true]);
  // Una casella mai toccata segue la preselezione di adesso.
  assert.equal(selectionFrom(open([fixed]), { ...choices, overrides: {} }).checked[named.id], true);
  // Una correzione che introduce un problema toglie la spunta.
  assert.equal(selectionFrom(open([{ ...inferred, issue: "lungo" }]), choices).checked[inferred.id], false);
  // Le scelte dei conflitti e la riga delle riconferme passano com'erano.
  const conflict = proposal({ kind: "conflitto", preselected: false });
  const withConflict = selectionFrom(open([conflict]), { overrides: { [conflict.id]: true }, resolutions: { [conflict.id]: "prima" }, reconfirm: false });
  assert.deepEqual(withConflict, { checked: { [conflict.id]: false }, resolutions: { [conflict.id]: "prima" }, reconfirm: false });
});

test("dopo una conferma: si resta se restano righe, si passa a tutte se l'appunto è finito, si torna alla Memoria se non resta niente", () => {
  assert.equal(afterConfirm({ leftHere: 2, remaining: 5, filtered: true }), "resta");
  assert.equal(afterConfirm({ leftHere: 0, remaining: 5, filtered: true }), "tutte");
  assert.equal(afterConfirm({ leftHere: 0, remaining: 3, filtered: false }), "resta", "senza filtro la pagina mostra già tutte le altre");
  assert.equal(afterConfirm({ leftHere: 0, remaining: 0, filtered: true }), "memoria");
  assert.equal(afterConfirm({ leftHere: 4, remaining: 0, filtered: false }), "memoria");
});

test("le voci si mandano a gruppi di al massimo 75", () => {
  const items = Array.from({ length: 160 }, (_, i) => i);
  assert.deepEqual(chunkItems(items).map((chunk) => chunk.length), [75, 75, 10]);
  assert.deepEqual(chunkItems([]), []);
  assert.deepEqual(chunkItems([1, 2, 3], 2), [[1, 2], [3]]);
});

test("i passaggi non riportati: una riga per motivo, sommando gli appunti, al singolare e al plurale", () => {
  assert.deepEqual(notReportedLines([{ persone: 1 }, { persone: 1, sanitari: 1 }, {}]), [
    `${T.confirm.notReported(2)}: ${T.confirm.notReportedWhy.persone(2)}`,
    `${T.confirm.notReported(1)}: ${T.confirm.notReportedWhy.sanitari(1)}`,
  ]);
  assert.equal(notReportedLines([{ persone: 2 }])[0], "2 passaggi non riportati: parlavano di persone");
  assert.deepEqual(notReportedLines([{ altri_clienti: 0, persone: -1 }, { clienti_del_cliente: 1.5 }]), [], "numeri non validi non contano");
});

test("la testata di «Da confermare»: un appunto, più appunti, nessuno", () => {
  assert.equal(confirmSubtitle([{ id: "a", kind: "appunti", origin: "web", title: "Call di avvio", occurredOn: "2026-11-14", skipped: {} }], TODAY), T.confirm.fromOne("Call di avvio", "14 nov"));
  assert.equal(
    confirmSubtitle(
      [
        { id: "a", kind: "appunti", origin: "web", title: "Uno", occurredOn: "2026-11-14", skipped: {} },
        { id: "b", kind: "documento", origin: "web", title: "Due", occurredOn: "2026-11-10", skipped: {} },
      ],
      TODAY,
    ),
    "Da 2 appunti",
  );
  assert.equal(confirmSubtitle([], TODAY), null);
});

test("la fonte di «Ora»: «Call 14 nov», «Documento 14 nov»; di un altro anno con l'anno", () => {
  assert.equal(proposalSourceLabel("appunti", "2026-11-14", TODAY), "Call 14 nov");
  assert.equal(proposalSourceLabel("documento", "2026-11-14", TODAY), "Documento 14 nov");
  assert.match(proposalSourceLabel("trascrizione", "2025-03-02", TODAY), /^Call 2 mar 2025$/);
  assert.equal(proposalSourceLabel(null, null, TODAY), T.fact.sourceCallWord);
  const sources = [
    { id: "s1", title: "Call", occurredOn: "2026-11-14", skipped: {} },
    { id: "s2", title: "Organigramma", occurredOn: "2026-11-12", skipped: {}, kind: "documento" as const },
  ];
  assert.equal(proposalSource({ sourceId: "s1" }, sources, TODAY), "Call 14 nov");
  assert.equal(proposalSource({ sourceId: "s2" }, sources, TODAY), "Documento 12 nov");
});

test("«Modifica» su una proposta: i campi per tipo, e solo quelli cambiati vanno al server", () => {
  assert.deepEqual(editableFields("nuovo"), { section: true, party: false, role: false, due: false });
  assert.deepEqual(editableFields("impegno"), { section: false, party: true, role: true, due: true });
  assert.deepEqual(editableFields("domanda"), { section: false, party: false, role: true, due: false });
  const p = proposal({ statement: "Il gestionale è SAP.", useCases: [{ id: "u1", code: "CX-0001", title: "Ordini" }] });
  const draft = proposalDraft(p);
  assert.deepEqual(proposalPatch(p, draft), {}, "niente cambiato, niente da mandare");
  assert.deepEqual(proposalPatch(p, { ...draft, statement: "  Il gestionale   è SAP Business One. ", section: "sistemi", useCaseIds: [] }), {
    statement: "Il gestionale è SAP Business One.",
    section: "sistemi",
    useCaseIds: [],
  });
  const commitment = proposal({ kind: "impegno", section: null, party: "nostra", roleLabel: "Responsabile IT", dueOn: null });
  const patch = proposalPatch(commitment, { ...proposalDraft(commitment), party: "cliente", roleLabel: " ", dueOn: "2026-11-30", section: "azienda" });
  assert.deepEqual(patch, { party: "cliente", roleLabel: null, dueOn: "2026-11-30" }, "un impegno non ha sezione");
});

test("gli errori di una conferma non riuscita si mostrano sulle righe che indicano", () => {
  assert.deepEqual(rowErrors({ a: "Scegli quale tenere.", c: "" }, ["a", "b", "c"]), { a: "Scegli quale tenere." });
  assert.deepEqual(rowErrors(undefined, ["a"]), {});
});

// ─── Etichette ───────────────────────────────────────────────────────

function source(over: Partial<SourceListItem> = {}): SourceListItem {
  return {
    id: "s1",
    kind: "appunti",
    origin: "granola",
    title: "Call di avvio",
    occurredOn: "2026-11-14",
    state: "da_leggere",
    readReason: null,
    openProposals: 0,
    visibility: "ls",
    document: null,
    canRemove: true,
    ...over,
  };
}

test("da dove viene una fonte e a che punto è: le etichette, mai un codice", () => {
  assert.equal(sourceOriginLabel(source()), "Granola");
  assert.equal(sourceOriginLabel(source({ origin: "web" })), "Web");
  assert.equal(sourceOriginLabel(source({ origin: "claude" })), "Claude");
  assert.equal(sourceOriginLabel(source({ kind: "documento", origin: "web" })), "Documento");
  assert.equal(sourceStateLabel(source()), "Da leggere");
  assert.equal(sourceStateLabel(source({ state: "in_lettura" })), "Leggo…");
  assert.equal(sourceStateLabel(source({ state: "da_confermare", openProposals: 4 })), "Da confermare (4)");
  assert.equal(sourceStateLabel(source({ state: "confermato" })), "Confermato");
  assert.equal(sourceStateLabel(source({ state: "letto" })), "Letto");
  assert.equal(sourceStateLabel(source({ state: "non_letto" })), "Non letto");
  assert.equal(sectionLabel("lavoro"), "Come lavorano");
  assert.equal(visibilityLabel("ls"), "Solo Lateral Space");
  assert.equal(visibilityLabel("tutti"), "Per tutti");
});

test("un documento senza testo da leggere: «Testo non letto»; dopo il caricamento si legge solo se il testo c'è", () => {
  assert.equal(sourceStateLabel(source({ kind: "documento", state: "non_letto", readReason: "vuoto" })), T.documents.unread);
  assert.equal(sourceStateLabel(source({ kind: "documento", state: "non_letto", readReason: "rifiuto" })), "Non letto");
  assert.equal(sourceStateLabel(source({ kind: "appunti", state: "non_letto", readReason: "vuoto" })), "Non letto");
  assert.deepEqual(afterUpload({ textRead: true, ai: "ok" }), { read: true, text: null, consent: false });
  assert.deepEqual(afterUpload({ textRead: true, ai: "ok_mancante" }), { read: true, text: null, consent: true });
  assert.deepEqual(afterUpload({ textRead: false, ai: "ok_mancante" }), { read: false, text: T.documents.scanned, consent: true });
  assert.deepEqual(afterUpload({ textRead: false, ai: "non_serve" }), { read: false, text: T.documents.unread, consent: false });
});

test("la riga di una fonte: per Lateral Space data, origine, stato e, per un documento, chi lo vede; per il cliente data e dimensione", () => {
  assert.deepEqual(sourceMeta(source({ state: "da_confermare", openProposals: 2 }), TODAY, true), ["14 nov", "Granola", "Da confermare (2)"]);
  const doc = source({ kind: "documento", origin: "web", state: "letto", visibility: "tutti", document: { id: "d1", fileName: "organigramma.pdf", fileType: "application/pdf", fileSize: 1_258_291 } });
  assert.deepEqual(sourceMeta(doc, TODAY, true), ["14 nov", "Documento", "Letto", "Per tutti"]);
  assert.deepEqual(sourceMeta(doc, TODAY, false), ["14 nov", "1,2 MB"]);
});

test("«Leggi» la prima volta, «Rileggi» dopo; niente mentre la sta leggendo qualcuno o dopo i 12 mesi", () => {
  assert.equal(sourceReadAction({ state: "da_leggere" }, false), "leggi");
  assert.equal(sourceReadAction({ state: "letto" }, false), "rileggi");
  assert.equal(sourceReadAction({ state: "non_letto" }, false), "rileggi");
  assert.equal(sourceReadAction({ state: "da_confermare" }, false), "rileggi");
  assert.equal(sourceReadAction({ state: "in_lettura" }, false), null);
  assert.equal(sourceReadAction({ state: "da_leggere" }, true), null);
});

test("le scadenze: «entro il 30 nov», «scaduto il 30 nov», niente senza data", () => {
  assert.equal(dueText({ dueOn: "2026-11-30", overdue: false }, TODAY), "entro il 30 nov");
  assert.equal(dueText({ dueOn: "2026-11-02", overdue: true }, TODAY), "scaduto il 2 nov");
  assert.equal(dueText({ dueOn: null, overdue: false }, TODAY), null);
});

test("un brano di «Chiedi al contesto»: il tipo, la fonte, la data, senza ripetere la data del fatto", () => {
  assert.equal(askSourceMeta({ kind: "fatto", label: "Call 14 nov", date: "2026-11-15" }, TODAY), "Fatto · Call 14 nov");
  assert.equal(askSourceMeta({ kind: "appunti", label: "Call di avvio", date: "2026-11-14" }, TODAY), "Appunti · Call di avvio · 14 nov");
  assert.equal(askSourceMeta({ kind: "discovery", label: "Discovery", date: null }, TODAY), "Discovery");
  assert.equal(askSourceMeta({ kind: "referente", label: "CX-0001", date: "2026-11-01" }, TODAY), "Risposta del referente · CX-0001 · 1 nov");
});

// ─── La Memoria ──────────────────────────────────────────────────────

function fact(over: Partial<FactView> = {}): FactView {
  return {
    id: "f1",
    version: 1,
    kind: "fatto",
    section: "sistemi",
    statement: "Il gestionale è SAP Business One.",
    basis: "detto",
    visibility: "tutti",
    needsCheck: false,
    sourceKind: "call",
    sourceLabel: "Call 14 nov",
    lastConfirmedOn: "2026-11-14",
    ...over,
  };
}

function memory(sections: MemorySection[], over: Partial<MemoryView> = {}): MemoryView {
  return {
    sections,
    nextSteps: { nostri: [], cliente: [] },
    questions: [],
    brief: null,
    novelties: null,
    counts: { facts: 0, openProposals: 0, unreadSources: 0, pendingSourceIds: [], toCheck: 0 },
    ...over,
  };
}

test("le sezioni vuote non si vedono; l'ordine resta quello fisso", () => {
  const sections: MemorySection[] = [
    { section: "azienda", live: [{ key: "k", section: "azienda", text: "Fa mobili su misura", tag: null }], facts: [] },
    { section: "persone", live: [], facts: [] },
    { section: "sistemi", live: [], facts: [fact()] },
    { section: "parole", live: [], facts: [] },
  ];
  assert.deepEqual(visibleSections(sections).map((s) => s.section), ["azienda", "sistemi"]);
});

test("la Memoria è vuota solo se non c'è niente da mostrare", () => {
  const none: MemorySection[] = [{ section: "azienda", live: [], facts: [] }];
  assert.equal(isMemoryEmpty(memory(none)), true);
  assert.equal(isMemoryEmpty(memory([{ section: "azienda", live: [], facts: [fact()] }])), false);
  assert.equal(isMemoryEmpty(memory(none, { questions: [{ id: "q", version: 1, question: "Chi decide?", askWhom: null, visibility: "tutti" }] })), false);
  assert.equal(
    isMemoryEmpty(memory(none, { nextSteps: { nostri: [{ id: "c", version: 1, statement: "Mandare il preventivo", party: "nostra", roleLabel: null, dueOn: null, overdue: false, visibility: "ls" }], cliente: [] } })),
    false,
  );
  assert.equal(isMemoryEmpty(memory(none, { brief: { lines: ["Fa mobili."], updatedOn: TODAY } })), false);
});

test("i segni di un fatto: solo quando servono", () => {
  assert.deepEqual(factMarks(fact()), { inferred: false, toCheck: false, lsOnly: false });
  assert.deepEqual(factMarks(fact({ basis: "dedotto", needsCheck: true, visibility: "ls" })), { inferred: true, toCheck: true, lsOnly: true });
});

test("l'avviso dell'ok: con qualcosa da leggere, o con un «In breve» da scrivere (almeno 3 voci «Per tutti»)", () => {
  const sections: MemorySection[] = [
    { section: "azienda", live: [{ key: "a", section: "azienda", text: "Uno", tag: null }], facts: [fact({ id: "x", visibility: "ls" })] },
    { section: "sistemi", live: [], facts: [fact({ id: "y" })] },
  ];
  assert.equal(briefMaterial(sections), 2, "un fatto «Solo Lateral Space» non entra in «In breve»");
  assert.equal(consentNoticeNeeded({ unreadSources: 0, brief: null, material: 2 }), false);
  assert.equal(consentNoticeNeeded({ unreadSources: 0, brief: null, material: 3 }), true);
  assert.equal(consentNoticeNeeded({ unreadSources: 0, brief: { lines: ["Una riga."], updatedOn: TODAY }, material: 9 }), false);
  assert.equal(consentNoticeNeeded({ unreadSources: 1, brief: null, material: 0 }), true);
});

// ─── (9b) La piega «Contesto» della scheda e la sezione del dossier ──

function caseFact(over: Partial<UseCaseFact> = {}): UseCaseFact {
  return { ...fact(), tag: null, ...over };
}
function caseCommitment(over: Partial<CommitmentView> = {}): CommitmentView {
  return { id: "c1", version: 1, statement: "Inviare l'esportazione delle fatture", party: "cliente", roleLabel: "Responsabile amministrativo", dueOn: "2026-11-25", overdue: false, visibility: "tutti", ...over };
}
function caseContext(over: Partial<UseCaseContext> = {}): UseCaseContext {
  return { facts: [], more: 0, novelties: 0, commitments: [], questions: [], ...over };
}
const QUESTION = { id: "q1", version: 1, question: "Chi approva gli acquisti sopra soglia?", askWhom: "Direzione acquisti", visibility: "tutti" as const };

test("la piega «Contesto» c'è solo con fatti, impegni o domande; senza lettura no", () => {
  assert.equal(contextFoldShown(null), false);
  assert.equal(contextFoldShown(undefined), false);
  assert.equal(contextFoldShown(caseContext()), false, "niente da mostrare: la piega non c'è");
  assert.equal(contextFoldShown(caseContext({ more: 3, novelties: 1 })), false, "senza righe a schermo non c'è niente da aprire");
  assert.equal(contextFoldShown(caseContext({ facts: [caseFact()] })), true);
  assert.equal(contextFoldShown(caseContext({ commitments: [caseCommitment()] })), true);
  assert.equal(contextFoldShown(caseContext({ questions: [QUESTION] })), true);
});

test("la riga della piega chiusa: fatti, novità, impegni, al singolare e al plurale; i pezzi a zero non ci sono", () => {
  const facts = (n: number) => Array.from({ length: n }, (_, i) => caseFact({ id: `f${i}` }));
  assert.equal(contextFoldSummary(caseContext({ facts: facts(1) })), "1 fatto sul cliente");
  assert.equal(contextFoldSummary(caseContext({ facts: facts(2) })), "2 fatti sul cliente");
  // I fatti oltre i 40 a schermo contano: 40 a schermo e altri 12.
  assert.equal(contextFoldSummary(caseContext({ facts: facts(40), more: 12, novelties: 1 })), "52 fatti sul cliente · 1 novità");
  assert.equal(contextFoldSummary(caseContext({ facts: facts(3), novelties: 2, commitments: [caseCommitment()] })), "3 fatti sul cliente · 2 novità · 1 impegno aperto");
  assert.equal(contextFoldSummary(caseContext({ facts: facts(1), commitments: [caseCommitment(), caseCommitment({ id: "c2" })] })), "1 fatto sul cliente · 2 impegni aperti");
  // Senza fatti il primo pezzo è l'impegno, senza il separatore davanti.
  assert.equal(contextFoldSummary(caseContext({ commitments: [caseCommitment()] })), "1 impegno aperto");
  assert.equal(contextFoldSummary(caseContext({ questions: [QUESTION] })), "", "solo domande: niente riga grigia");
});

test("«Novità»: solo i fatti con «Nuovo» o «Cambiato», al massimo 5, i più recenti prima", () => {
  const items = [
    caseFact({ id: "a", tag: null, lastConfirmedOn: "2026-11-18" }),
    caseFact({ id: "b", tag: "nuovo", lastConfirmedOn: "2026-11-10" }),
    caseFact({ id: "c", tag: "cambiato", lastConfirmedOn: "2026-11-16" }),
    caseFact({ id: "d", tag: "nuovo", lastConfirmedOn: "2026-11-12" }),
    caseFact({ id: "e", tag: "nuovo", lastConfirmedOn: "2026-11-12" }),
    caseFact({ id: "f", tag: "nuovo", lastConfirmedOn: "2026-11-05" }),
    caseFact({ id: "g", tag: "cambiato", lastConfirmedOn: "2026-11-15" }),
  ];
  assert.deepEqual(contextFoldNovelties(items).map((f) => f.id), ["c", "g", "d", "e", "b"]);
  assert.equal(CASE_NOVELTIES_MAX, 5);
  assert.deepEqual(contextFoldNovelties([caseFact()]), []);
  assert.deepEqual([noveltyTag("nuovo"), noveltyTag("cambiato"), noveltyTag(null)], [T.novelties.tagNew, T.novelties.tagChanged, null]);
});

test("«Che cosa sappiamo»: i fatti per sezione, nell'ordine fisso; dentro, l'ordine in cui arrivano", () => {
  const groups = contextFactGroups([
    caseFact({ id: "r", section: "regole" }),
    caseFact({ id: "s1", section: "sistemi" }),
    caseFact({ id: "a", section: "azienda" }),
    caseFact({ id: "s2", section: "sistemi" }),
  ]);
  assert.deepEqual(
    groups.map((g) => [g.section, g.label, g.facts.map((f) => f.id)]),
    [
      ["azienda", "Azienda", ["a"]],
      ["sistemi", "Sistemi e dati", ["s1", "s2"]],
      ["regole", "Regole e vincoli", ["r"]],
    ],
  );
  assert.deepEqual(contextFactGroups([]), []);
});

test("«Da confermare»: «Risponde a «Cosa serve»» solo per una proposta «Per tutti»; «Solo Lateral Space» non chiude una richiesta, e lo dice", () => {
  const answersNeed = { needId: "n1", title: "L'elenco dei fornitori", code: "XX-0012" };
  assert.equal(answersNeedLine({ answersNeed, visibility: "tutti" }), "Risponde a «Cosa serve»: L'elenco dei fornitori (XX-0012)");
  assert.equal(answersNeedLine({ answersNeed, visibility: "ls" }), "Solo un fatto «Per tutti» chiude una richiesta.");
  assert.equal(answersNeedLine({ answersNeed: null, visibility: "tutti" }), null);
  assert.equal(answersNeedLine({ visibility: "ls" }), null);
});

test("«Cosa serve»: «Una call del 14 nov risponde: «…»», o «Un documento del …» quando il fatto viene da un documento", () => {
  const link = { id: "l1", needId: "n1", statement: "Gli ordini arrivano via e-mail.", from: "call" as const, date: "14 nov" };
  assert.equal(needLinkText(link), "Una call del 14 nov risponde: «Gli ordini arrivano via e-mail.»");
  assert.equal(needLinkText({ ...link, from: "documento", date: "3 ott 2025" }), "Un documento del 3 ott 2025 risponde: «Gli ordini arrivano via e-mail.»");
  assert.deepEqual([T.needLink.close, T.needLink.dismiss], ["Chiudi con questo", "Non risponde"]);
});

test("il dossier, «Leggi i file»: i tre file di sempre, poi CONTESTO.md quando c'è; mai un altro nome", () => {
  const three = { "PACCHETTO.md": "p", "BRIEF.md": "b", VERSIONE: "3" };
  assert.deepEqual(packageFilesShown(three).map((f) => f.name), ["BRIEF.md", "PACCHETTO.md", "VERSIONE"]);
  assert.deepEqual(packageFilesShown({ ...three, "CONTESTO.md": "# Contesto del cliente per XX-0012 (k3)" }), [
    { name: "BRIEF.md", text: "b" },
    { name: "PACCHETTO.md", text: "p" },
    { name: "VERSIONE", text: "3" },
    { name: CONTEXT_PACKAGE_FILE, text: "# Contesto del cliente per XX-0012 (k3)" },
  ]);
  assert.deepEqual(packageFilesShown({ ...three, "ALTRO.md": "x", "CONTESTO.md": 12 }).map((f) => f.name), ["BRIEF.md", "PACCHETTO.md", "VERSIONE"], "un nome fuori elenco o un valore che non è testo no");
  assert.deepEqual(packageFilesShown(null), []);
});

test("il dossier, la riga del pacchetto: le novità (le righe di CONTESTO.md che cambierebbero, `packageContextDelta`); niente senza novità", () => {
  assert.equal(packageDeltaLine(0), null);
  assert.equal(packageDeltaLine(-2), null);
  assert.equal(packageDeltaLine(Number.NaN), null);
  assert.equal(packageDeltaLine(1), "Il contesto è cambiato dopo l'ultimo pacchetto (1 novità).");
  assert.equal(packageDeltaLine(3), "Il contesto è cambiato dopo l'ultimo pacchetto (3 novità).");
});

test("«Da verificare»: la riga di servizio solo per Lateral Space e solo con fatti da verificare, al singolare e al plurale", () => {
  assert.equal(toCheckRow(0, true), null);
  assert.equal(toCheckRow(1, true), "1 fatto da verificare");
  assert.equal(toCheckRow(3, true), "3 fatti da verificare");
  assert.equal(toCheckRow(3, false), null, "il cliente non la vede");
  assert.equal(toCheckRow(Number.NaN, true), null);
  assert.equal(toCheckMeta({ sourceLabel: "Call 14 nov", lastConfirmedOn: "2026-05-14" }, TODAY), "Call 14 nov · Ultima conferma: 14 mag");
  assert.equal(toCheckMeta({ sourceLabel: "Scritto a mano", lastConfirmedOn: "2025-04-02" }, TODAY), "Scritto a mano · Ultima conferma: 2 apr 2025");
  assert.equal(toCheckMeta({ sourceLabel: "senza fonte", lastConfirmedOn: "" }, TODAY), "senza fonte");
});

test("«Da verificare»: nessuna casella spuntata all'inizio; «Ancora veri (n)» conta le spuntate ancora in pagina", () => {
  const facts = [fact({ id: "a" }), fact({ id: "b" }), fact({ id: "c" })];
  const start = initialVerifyChoice();
  assert.equal(start.size, 0, "niente di spuntato all'inizio");
  assert.notEqual(initialVerifyChoice(), start, "ogni pagina parte da una scelta sua");
  assert.deepEqual(verifyChosen(facts, start), []);
  assert.equal(verifyButtonLabel(facts, start), "Ancora veri (0)");
  const chosen = new Set(["c", "a"]);
  assert.deepEqual(verifyChosen(facts, chosen), ["a", "c"], "nell'ordine della pagina");
  assert.equal(verifyButtonLabel(facts, chosen), "Ancora veri (2)");
  // Un fatto tolto con «Non più vero» (o già riconfermato da qualcun altro) esce dalla pagina e dal conto.
  assert.equal(verifyButtonLabel(facts.filter((f) => f.id !== "a"), chosen), "Ancora veri (1)");
  assert.equal(verifyButtonLabel(facts, new Set(["x"])), "Ancora veri (0)");
});

test("«Impegni aperti»: «Nostri» e «Del cliente», solo i gruppi con righe, nell'ordine in cui arrivano", () => {
  const groups = contextCommitmentGroups([caseCommitment({ id: "x" }), caseCommitment({ id: "y", party: "nostra" }), caseCommitment({ id: "z" })]);
  assert.deepEqual(
    groups.map((g) => [g.label, g.items.map((c) => c.id)]),
    [
      [T.nextSteps.ours, ["y"]],
      [T.nextSteps.theirs, ["x", "z"]],
    ],
  );
  assert.deepEqual(contextCommitmentGroups([caseCommitment()]).map((g) => g.label), ["Del cliente"]);
  assert.deepEqual(contextCommitmentGroups([]), []);
});

// ─── «Aggiungi appunti» ──────────────────────────────────────────────

test("il titolo proposto: la prima riga non vuota, senza segni di elenco, al massimo 80 caratteri", () => {
  assert.equal(proposedTitle("\n\n  ## Call di avvio con Nardi  \nAltro"), "Call di avvio con Nardi");
  assert.equal(proposedTitle("- primo punto\n- secondo"), "primo punto");
  assert.equal(proposedTitle("   \n "), "");
  const long = `${"parola ".repeat(20)}fine`;
  const title = proposedTitle(long);
  assert.ok(title.length <= 80 && !title.endsWith(" ") && long.startsWith(title), title);
});

test("il titolo di un file, l'estensione, il tipo e la dimensione a schermo", () => {
  assert.equal(titleFromFileName("Verbale_call_14-11.docx"), "Verbale call 14-11");
  assert.equal(titleFromFileName("C:\\cartella\\appunti.md"), "appunti");
  assert.equal(titleFromFileName(".nascosto"), ".nascosto");
  assert.equal(fileExtension("Report.PDF"), "pdf");
  assert.equal(fileExtension("senza"), "");
  assert.equal(fileTypeText("organigramma.xlsx"), "XLSX");
  assert.equal(fileSizeText(12), "12 B");
  assert.equal(fileSizeText(340 * 1024), "340 KB");
  assert.equal(fileSizeText(1_258_291), "1,2 MB");
  assert.equal(fileSizeText(-1), "");
});

test("un file trascinato: il testo si legge nel browser, i documenti si caricano, oltre 4 MB o in un altro formato no", () => {
  assert.deepEqual(droppedFileKind({ name: "appunti.txt", size: 100 }), { kind: "testo" });
  assert.deepEqual(droppedFileKind({ name: "appunti.MD", size: 100 }), { kind: "testo" });
  for (const name of ["a.pdf", "a.docx", "a.xlsx", "a.pptx", "a.csv", "a.tsv"]) assert.deepEqual(droppedFileKind({ name, size: 100 }), { kind: "documento" }, name);
  assert.deepEqual(droppedFileKind({ name: "a.doc", size: 100 }), { kind: "rifiutato", message: T.documents.badType });
  assert.deepEqual(droppedFileKind({ name: "a.pdf", size: 4 * 1024 * 1024 + 1 }), { kind: "rifiutato", message: T.documents.tooBig });
  assert.deepEqual(droppedFileKind({ name: "a.pdf", size: 0 }), { kind: "rifiutato", message: T.documents.tooBig });
  assert.deepEqual(uploadableDocument({ name: "a.md", size: 10 }), { ok: true });
  assert.deepEqual(uploadableDocument({ name: "a.exe", size: 10 }), { ok: false, message: T.documents.badType });
});

test("un .txt o un .md trascinato: UTF-8 se lo è, altrimenti Windows-1252, come il caricamento dei documenti", () => {
  // «Qualità è alta — 3 €» salvato da Blocco note in «ANSI» (Windows-1252).
  const ansi = Uint8Array.from([0x51, 0x75, 0x61, 0x6c, 0x69, 0x74, 0xe0, 0x20, 0xe8, 0x20, 0x61, 0x6c, 0x74, 0x61, 0x20, 0x97, 0x20, 0x33, 0x20, 0x80]);
  assert.equal(droppedText(ansi), "Qualità è alta — 3 €");
  const utf8 = new TextEncoder().encode("Qualità è alta — 3 €");
  assert.equal(droppedText(utf8), "Qualità è alta — 3 €");
  assert.equal(droppedText(Uint8Array.from([0xef, 0xbb, 0xbf, ...utf8])), "Qualità è alta — 3 €", "senza il BOM");
  assert.equal(droppedText(new Uint8Array()), "");
});

test("i controlli prima di salvare: gli stessi limiti del server, i messaggi di CONTEXT_TEXT", () => {
  const ok = { body: "Il gestionale è SAP Business One, gli ordini a mano.", title: "Call di avvio", occurredOn: "2026-11-14", link: "", hasFile: false };
  assert.deepEqual(noteDraftErrors(ok), {});
  assert.deepEqual(noteDraftErrors({ ...ok, body: "corto" }), { body: T.add.tooShort });
  assert.deepEqual(noteDraftErrors({ ...ok, body: "x".repeat(300_001) }), { body: T.add.tooLong });
  assert.deepEqual(noteDraftErrors({ ...ok, body: "", hasFile: true }), {}, "con un file gli appunti non servono");
  assert.deepEqual(noteDraftErrors({ ...ok, title: "  a " }), { title: T.add.titleMissing });
  assert.deepEqual(noteDraftErrors({ ...ok, occurredOn: "14/11/2026" }), { occurredOn: T.add.dateMissing });
  assert.deepEqual(noteDraftErrors({ ...ok, link: "http://esempio.it" }), { link: T.add.linkInvalid });
  assert.deepEqual(noteDraftErrors({ ...ok, link: "https://esempio.it/nota" }), {});
});

test("«Chiudi» su «Aggiungi appunti»: prima di salvare tiene il testo; dopo aggiorna la pagina e riparte vuota", () => {
  assert.deepEqual(addNotesClose("modulo"), { keepDraft: true, refresh: false });
  for (const phase of ["salvo", "leggo", "fatto"] as const) assert.deepEqual(addNotesClose(phase), { keepDraft: false, refresh: true }, phase);
});

// ─── La lettura ──────────────────────────────────────────────────────

test("l'esito di una lettura a schermo: «Riprova» per tempo ed errore, mai dopo un rifiuto", () => {
  assert.equal(readOutcomeMessage({ status: "letto", proposals: 3, skipped: {} }), null, "con proposte si va a «Da confermare»");
  assert.deepEqual(readOutcomeMessage({ status: "letto", proposals: 0, skipped: {} }), { text: T.add.nothingNew, retry: false, tone: "fatto" });
  assert.deepEqual(readOutcomeMessage({ status: "in_corso", partsRead: 1, partsTotal: 3 }), { text: "Leggo gli appunti… 2 di 3", retry: false, tone: "attesa" });
  assert.deepEqual(readOutcomeMessage({ status: "ok_mancante" }), { text: T.add.savedNoConsent, retry: false, tone: "attesa" });
  assert.deepEqual(readOutcomeMessage({ status: "in_lettura" }), { text: T.read.busy, retry: false, tone: "attesa" });
  assert.deepEqual(readOutcomeMessage({ status: "rifiuto" }), { text: T.read.refused, retry: false, tone: "problema" });
  assert.deepEqual(readOutcomeMessage({ status: "tempo" }), { text: T.read.timeout, retry: true, tone: "problema" });
  assert.deepEqual(readOutcomeMessage({ status: "errore" }), { text: T.read.failed, retry: true, tone: "problema" });
  assert.deepEqual(readOutcomeMessage({ status: "limite" }), { text: T.read.limit, retry: false, tone: "problema" });
});

test("il messaggio di una risposta d'errore: la frase della rotta, mai un codice", () => {
  assert.equal(responseMessage({ error: "dati_non_validi", message: "Controlla i campi indicati." }), "Controlla i campi indicati.");
  assert.equal(responseMessage({ error: "File troppo grande: al massimo 4 MB." }), "File troppo grande: al massimo 4 MB.");
  assert.equal(responseMessage({ error: "file_troppo_grande" }), T.errors.retry);
  assert.equal(responseMessage(null, "Riprova"), "Riprova");
  assert.equal(responseMessage("testo"), T.errors.retry);
});
