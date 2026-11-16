/**
 * Le regole della pagina «Contesto» (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md §7): che cosa si mostra,
 * in che ordine e con quale etichetta. Funzioni pure: le usano i componenti della pagina e le prova
 * `view-model.test.ts` con `node --test`.
 *
 * - «Da confermare» (§7.4): i gruppi nell'ordine fisso; «dedotto» e conflitti mai spuntati da soli; una proposta da
 *   correggere non si spunta; un conflitto senza scelta non entra nel conto; le riconferme preselezionate («detto»)
 *   in una riga sola, spuntata; le altre («dedotto», o da un documento del cliente) una per una, senza spunta.
 * - La Memoria (§7.2): le sezioni vuote non si vedono; le scadenze degli impegni.
 * - Gli appunti e i documenti (§7.5): da dove vengono, a che punto è la lettura, chi li vede.
 * - «Aggiungi appunti» (§7.3): il titolo proposto, i file che si leggono nel browser e quelli che si caricano.
 *
 * Nessun testo scritto qui: ogni parola viene da `CONTEXT_TEXT`. Modulo puro, senza `node:` (lo usano i componenti
 * client).
 */
import { dayLabel } from "../../lib/context/labels.ts";
import { CONTEXT_TEXT } from "../../lib/context/text.ts";
import { CONTEXT_LIMITS, type ContextSection, type ContextVisibility, type ProposalKind, type SkippedCounts, type SourceKind, type SourceOrigin } from "../../lib/context/vocab.ts";
import type { AskSource } from "../../lib/db/queries/context-ask.ts";
import type { FactView, MemorySection, MemoryView } from "../../lib/db/queries/context-memory.ts";
import type { ConfirmItem, OpenProposals, ProposalPatch, ProposalView } from "../../lib/db/queries/context-proposals.ts";
import type { ReadOutcome } from "../../lib/db/queries/context-read.ts";
import type { SourceListItem, SourceState } from "../../lib/db/queries/context-sources.ts";
import { decodeWindows1252 } from "../../lib/uc/files/charset.ts";

const T = CONTEXT_TEXT;

// ─── «Da confermare» ─────────────────────────────────────────────────

export type ConfirmGroupKey = "nuovi" | "cambiano" | "conflitti" | "impegni" | "domande";
export interface ConfirmGroup {
  key: ConfirmGroupKey;
  label: string;
  items: ProposalView[];
}

/** Il gruppo di ogni tipo di proposta. Le riconferme non hanno un gruppo: stanno in una riga sola in fondo. */
const GROUP_OF: Readonly<Record<ProposalKind, ConfirmGroupKey | null>> = Object.freeze({
  nuovo: "nuovi",
  decisione: "nuovi",
  cambia: "cambiano",
  conflitto: "conflitti",
  impegno: "impegni",
  domanda: "domande",
  conferma: null,
});

const GROUP_ORDER: readonly ConfirmGroupKey[] = ["nuovi", "cambiano", "conflitti", "impegni", "domande"];
const GROUP_LABEL: Readonly<Record<ConfirmGroupKey, string>> = Object.freeze({
  nuovi: T.confirm.groupNew,
  cambiano: T.confirm.groupChanged,
  conflitti: T.confirm.groupConflicts,
  impegni: T.confirm.groupCommitments,
  domande: T.confirm.groupQuestions,
});

/** I gruppi di «Da confermare», nell'ordine fisso, solo quelli con righe. Dentro un gruppo l'ordine resta quello delle proposte. */
export function confirmGroups(proposals: readonly ProposalView[]): ConfirmGroup[] {
  const byGroup = new Map<ConfirmGroupKey, ProposalView[]>();
  for (const proposal of proposals) {
    const key = GROUP_OF[proposal.kind];
    if (!key) continue;
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key)!.push(proposal);
  }
  return GROUP_ORDER.filter((key) => byGroup.has(key)).map((key) => ({ key, label: GROUP_LABEL[key], items: byGroup.get(key)! }));
}

export type Resolution = "prima" | "ora";
/** Che cosa ha scelto la persona: le caselle, la scelta di ogni conflitto, la riga delle riconferme. */
export interface ConfirmSelection {
  checked: Readonly<Record<string, boolean>>;
  resolutions: Readonly<Record<string, Resolution>>;
  reconfirm: boolean;
}

/** Una casella si può spuntare: non un conflitto (lì si sceglie «Prima» o «Ora») e nessun dato da correggere. */
export function isCheckable(proposal: Pick<ProposalView, "kind" | "issue">): boolean {
  return proposal.kind !== "conflitto" && proposal.issue === null;
}

/**
 * Le scelte della persona sopra le proposte del server: le caselle toccate a mano, la scelta di ogni conflitto, la riga
 * delle riconferme. Le proposte arrivano sempre dal server (dopo una correzione, uno scarto, un aggiornamento): una
 * casella mai toccata segue la preselezione della proposta di adesso.
 */
export interface ConfirmChoices {
  overrides: Readonly<Record<string, boolean>>;
  resolutions: Readonly<Record<string, Resolution>>;
  reconfirm: boolean;
}
export const NO_CHOICES: ConfirmChoices = Object.freeze({ overrides: Object.freeze({}), resolutions: Object.freeze({}), reconfirm: true });

/**
 * Le caselle a schermo: spuntate le proposte `preselected` (base «detto», non un conflitto, niente da correggere),
 * oppure come le ha messe la persona. Una proposta da correggere o un conflitto non si spuntano mai; corretta, torna
 * come prima (la scelta a mano resta). Nessun conflitto ha una scelta di partenza. Le riconferme preselezionate stanno
 * nella riga delle riconferme, che parte spuntata; le altre hanno una casella loro, che parte senza spunta.
 */
export function selectionFrom(open: Pick<OpenProposals, "proposals"> & Partial<Pick<OpenProposals, "reconfirmed">>, choices: ConfirmChoices = NO_CHOICES): ConfirmSelection {
  const checked: Record<string, boolean> = {};
  for (const proposal of [...open.proposals, ...reconfirmationsToChoose({ reconfirmed: open.reconfirmed ?? [] })]) {
    checked[proposal.id] = isCheckable(proposal) && (choices.overrides[proposal.id] ?? proposal.preselected);
  }
  return { checked, resolutions: choices.resolutions, reconfirm: choices.reconfirm };
}

/** La scelta di partenza: nessuna scelta della persona. */
export function initialSelection(open: Pick<OpenProposals, "proposals"> & Partial<Pick<OpenProposals, "reconfirmed">>): ConfirmSelection {
  return selectionFrom(open, NO_CHOICES);
}

/**
 * Le voci da mandare a `confirmProposals`: le righe spuntate, i conflitti con una scelta, le riconferme preselezionate
 * se la loro riga è spuntata, e le altre riconferme spuntate una per una.
 */
export function selectedItems(open: Pick<OpenProposals, "proposals" | "reconfirmed">, selection: ConfirmSelection): ConfirmItem[] {
  const items: ConfirmItem[] = [];
  for (const proposal of open.proposals) {
    if (proposal.issue !== null) continue;
    if (proposal.kind === "conflitto") {
      const resolution = selection.resolutions[proposal.id];
      if (resolution === "prima" || resolution === "ora") items.push({ id: proposal.id, version: proposal.version, resolution });
      continue;
    }
    if (selection.checked[proposal.id] === true) items.push({ id: proposal.id, version: proposal.version });
  }
  if (selection.reconfirm) {
    for (const proposal of reconfirmable(open)) items.push({ id: proposal.id, version: proposal.version });
  }
  for (const proposal of reconfirmationsToChoose(open)) {
    if (selection.checked[proposal.id] === true) items.push({ id: proposal.id, version: proposal.version });
  }
  return items;
}

/** Il numero di «Conferma (n)». */
export function confirmCount(open: Pick<OpenProposals, "proposals" | "reconfirmed">, selection: ConfirmSelection): number {
  return selectedItems(open, selection).length;
}

/** Le riconferme che entrano con la riga spuntata: le preselezionate («detto»), senza niente da correggere. */
export function reconfirmable(open: Pick<OpenProposals, "reconfirmed">): ProposalView[] {
  return open.reconfirmed.filter((proposal) => proposal.issue === null && proposal.preselected);
}

/**
 * Le riconferme da scegliere una per una: «dedotto», o da un documento del cliente, o di un fatto «Solo Lateral Space».
 * Partono senza spunta, come fa l'MCP del team.
 */
export function reconfirmationsToChoose(open: Pick<OpenProposals, "reconfirmed">): ProposalView[] {
  return open.reconfirmed.filter((proposal) => proposal.issue === null && !proposal.preselected);
}

/**
 * Dopo una conferma riuscita (§7.4): si resta se qui restano righe; se questo appunto è finito ma ce ne sono altri si
 * passa a tutte le proposte; senza più niente da confermare si torna alla Memoria. `remaining` sono le proposte aperte
 * del workspace, dopo la conferma.
 */
export function afterConfirm(i: { leftHere: number; remaining: number; filtered: boolean }): "resta" | "tutte" | "memoria" {
  if (i.remaining <= 0) return "memoria";
  if (i.leftHere > 0 || !i.filtered) return "resta";
  return "tutte";
}

/** Le voci in gruppi da al massimo 75 (`confirmMax`): ogni gruppo è una conferma, tutta o niente. */
export function chunkItems<T>(items: readonly T[], size: number = CONTEXT_LIMITS.confirmMax): T[][] {
  const step = Math.max(1, Math.trunc(size));
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += step) out.push(items.slice(i, i + step));
  return out;
}

const SKIPPED_REASONS = ["persone", "sanitari", "altri_clienti", "clienti_del_cliente"] as const;

/** «2 passaggi non riportati: parlavano di persone», una riga per motivo, sommando gli appunti mostrati. */
export function notReportedLines(skipped: readonly SkippedCounts[]): string[] {
  const lines: string[] = [];
  for (const reason of SKIPPED_REASONS) {
    const n = skipped.reduce((sum, counts) => sum + (Number.isInteger(counts?.[reason]) && counts[reason]! > 0 ? counts[reason]! : 0), 0);
    if (n > 0) lines.push(`${T.confirm.notReported(n)}: ${T.confirm.notReportedWhy[reason](n)}`);
  }
  return lines;
}

/** La testata: «Dagli appunti «Call di avvio» del 14 nov» con un appunto solo, «Da 3 appunti» con di più, niente senza. */
export function confirmSubtitle(sources: OpenProposals["sources"], today: string): string | null {
  if (sources.length === 0) return null;
  if (sources.length === 1) return T.confirm.fromOne(sources[0].title, dayLabel(sources[0].occurredOn, today));
  return T.confirm.fromMany(sources.length);
}

/** «Call 14 nov» o «Documento 14 nov»: da dove viene una proposta, per «Ora: … (Call 14 nov)». */
export function proposalSourceLabel(kind: SourceKind | null | undefined, occurredOn: string | null | undefined, today: string): string {
  const day = dayLabel(occurredOn ?? null, today);
  if (kind === "documento") return day ? T.fact.sourceDocument(day) : T.fact.sourceDocumentWord;
  return day ? T.fact.sourceCall(day) : T.fact.sourceCallWord;
}

/** Una fonte di «Da confermare»: `kind` dice se è una call o un documento. */
export type ConfirmSource = Pick<OpenProposals["sources"][number], "id" | "occurredOn"> & { kind?: SourceKind };

/** La fonte di una proposta, per «Ora: … (Call 14 nov)»: quella del suo appunto. */
export function proposalSource(proposal: Pick<ProposalView, "sourceId">, sources: readonly ConfirmSource[], today: string): string {
  const source = sources.find((item) => item.id === proposal.sourceId);
  return proposalSourceLabel(source?.kind ?? null, source?.occurredOn ?? null, today);
}

/** Il campo di una proposta da correggere sul posto: che cosa si può cambiare, per tipo (§7.4). */
export function editableFields(kind: ProposalKind): { section: boolean; party: boolean; role: boolean; due: boolean } {
  if (kind === "impegno") return { section: false, party: true, role: true, due: true };
  if (kind === "domanda") return { section: false, party: false, role: true, due: false };
  return { section: true, party: false, role: false, due: false };
}

/** Le modifiche di una proposta rispetto a com'era: solo i campi cambiati, pronti per `editProposal`. */
export interface ProposalDraft {
  statement: string;
  section: ContextSection | null;
  visibility: ContextVisibility;
  useCaseIds: string[];
  party: "nostra" | "cliente" | null;
  roleLabel: string;
  dueOn: string;
}
export function proposalDraft(proposal: ProposalView): ProposalDraft {
  return {
    statement: proposal.statement,
    section: proposal.section,
    visibility: proposal.visibility,
    useCaseIds: proposal.useCases.map((useCase) => useCase.id),
    party: proposal.party,
    roleLabel: proposal.roleLabel ?? "",
    dueOn: proposal.dueOn ?? "",
  };
}
export function proposalPatch(proposal: ProposalView, draft: ProposalDraft): ProposalPatch {
  const fields = editableFields(proposal.kind);
  const patch: ProposalPatch = {};
  const statement = draft.statement.replace(/\s+/g, " ").trim();
  if (statement !== proposal.statement) patch.statement = statement;
  if (fields.section && draft.section && draft.section !== proposal.section) patch.section = draft.section;
  if (draft.visibility !== proposal.visibility) patch.visibility = draft.visibility;
  const before = proposal.useCases.map((useCase) => useCase.id);
  if (draft.useCaseIds.length !== before.length || draft.useCaseIds.some((id) => !before.includes(id))) patch.useCaseIds = [...draft.useCaseIds];
  if (fields.party && draft.party && draft.party !== proposal.party) patch.party = draft.party;
  const role = draft.roleLabel.replace(/\s+/g, " ").trim();
  if (fields.role && role !== (proposal.roleLabel ?? "")) patch.roleLabel = role || null;
  const due = draft.dueOn.trim();
  if (fields.due && due !== (proposal.dueOn ?? "")) patch.dueOn = due || null;
  return patch;
}

/** Le voci di «Da confermare» che una conferma non riuscita indica (`fieldErrors[<id>]`): una riga, un messaggio. */
export function rowErrors(fieldErrors: Readonly<Record<string, string>> | undefined, ids: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  if (!fieldErrors) return out;
  for (const id of ids) if (typeof fieldErrors[id] === "string" && fieldErrors[id]) out[id] = fieldErrors[id];
  return out;
}

// ─── Etichette ───────────────────────────────────────────────────────

export function sectionLabel(section: ContextSection): string {
  return T.sections[section];
}

export function visibilityLabel(visibility: ContextVisibility): string {
  return visibility === "ls" ? T.fact.lsOnly : T.fact.forAll;
}

/** Da dove viene una fonte: «Granola», «Web», «Claude», «CLI»; un documento è sempre «Documento». */
export function sourceOriginLabel(item: { kind: SourceKind; origin: SourceOrigin }): string {
  return item.kind === "documento" ? T.notes.origin.documento : T.notes.origin[item.origin];
}

/**
 * A che punto è una fonte: «Da leggere», «Leggo…», «Da confermare (4)», «Confermato», «Letto», «Non letto». Un
 * documento senza testo da leggere (una scansione, un file vuoto) è «Testo non letto».
 */
export function sourceStateLabel(item: { state: SourceState; openProposals: number; kind?: SourceKind; readReason?: string | null }): string {
  if (item.state === "da_confermare") return T.notes.state.da_confermare(item.openProposals);
  if (item.state === "non_letto" && item.kind === "documento" && item.readReason === "vuoto") return T.documents.unread;
  return T.notes.state[item.state];
}

/**
 * Dopo il caricamento di un documento (§10.2, §6.2): si legge solo se il testo c'è. Una scansione senza l'ok ai
 * fornitori lo dice, con l'avviso; un file senza testo è «Testo non letto». `consent`: manca l'ok.
 */
export function afterUpload(doc: { textRead: boolean; ai: "ok" | "ok_mancante" | "non_serve" }): { read: boolean; text: string | null; consent: boolean } {
  const consent = doc.ai === "ok_mancante";
  if (!doc.textRead) return { read: false, text: consent ? T.documents.scanned : T.documents.unread, consent };
  return { read: true, text: null, consent };
}

/**
 * La riga sotto il titolo di una fonte, nell'elenco: la data, da dove viene, a che punto è la lettura e, per un
 * documento, chi lo vede. Il cliente vede solo documenti: data e dimensione.
 */
export function sourceMeta(item: SourceListItem, today: string, lateralSpace: boolean): string[] {
  const day = dayLabel(item.occurredOn, today);
  if (!lateralSpace) return [day, item.document ? fileSizeText(item.document.fileSize) : ""].filter(Boolean);
  const parts = [day, sourceOriginLabel(item), sourceStateLabel(item)];
  if (item.kind === "documento") parts.push(visibilityLabel(item.visibility));
  return parts.filter(Boolean);
}

/** Che cosa si può fare su una fonte (Lateral Space): leggere la prima volta, rileggere, o niente mentre la legge qualcuno. */
export function sourceReadAction(item: { state: SourceState }, purged: boolean): "leggi" | "rileggi" | null {
  if (purged || item.state === "in_lettura") return null;
  return item.state === "da_leggere" ? "leggi" : "rileggi";
}

/** «entro il 30 nov», oppure «scaduto il 30 nov» se è passato; niente senza scadenza. */
export function dueText(commitment: { dueOn: string | null; overdue: boolean }, today: string): string | null {
  if (!commitment.dueOn) return null;
  const day = dayLabel(commitment.dueOn, today);
  if (!day) return null;
  return commitment.overdue ? T.nextSteps.overdue(day) : T.nextSteps.due(day);
}

/** Il tipo, la fonte e la data di un brano di «Chiedi al contesto»: «Fatto · Call 14 nov», «Appunti · Call di avvio · 14 nov». */
export function askSourceMeta(source: Pick<AskSource, "kind" | "label" | "date">, today: string): string {
  const parts: string[] = [T.ask.kind[source.kind]];
  if (source.label && source.label !== parts[0]) parts.push(source.label);
  // Un fatto porta la data dentro la sua fonte («Call 14 nov»): la data dell'ultima conferma non si ripete.
  const day = source.kind === "fatto" ? "" : dayLabel(source.date, today);
  if (day && !parts.some((part) => part.endsWith(day))) parts.push(day);
  return parts.join(" · ");
}

// ─── La Memoria ──────────────────────────────────────────────────────

/** Le sezioni con qualcosa dentro (dati della Discovery o fatti), nell'ordine fisso: quelle vuote non si vedono. */
export function visibleSections(sections: readonly MemorySection[]): MemorySection[] {
  return sections.filter((section) => section.live.length > 0 || section.facts.length > 0);
}

/** Vero se la Memoria non ha niente da mostrare: nessun fatto, nessun dato della Discovery, niente in breve, nessun impegno, nessuna domanda. */
export function isMemoryEmpty(view: Pick<MemoryView, "sections" | "nextSteps" | "questions" | "brief" | "novelties">): boolean {
  return (
    visibleSections(view.sections).length === 0 &&
    view.nextSteps.nostri.length === 0 &&
    view.nextSteps.cliente.length === 0 &&
    view.questions.length === 0 &&
    (view.brief === null || view.brief.lines.length === 0) &&
    (view.novelties === null || view.novelties.items.length === 0)
  );
}

/** I segni di un fatto, solo quando servono: «dedotto», «da verificare», il lucchetto «Solo Lateral Space». */
export interface FactMarks {
  inferred: boolean;
  toCheck: boolean;
  lsOnly: boolean;
}
export function factMarks(fact: Pick<FactView, "basis" | "needsCheck" | "visibility">): FactMarks {
  return { inferred: fact.basis === "dedotto", toCheck: fact.needsCheck === true, lsOnly: fact.visibility === "ls" };
}

/** Quante voci ha la Memoria per «In breve» (fatti e dati della Discovery): sotto le 3 il riassunto non si scrive. */
export function briefMaterial(sections: readonly MemorySection[]): number {
  return sections.reduce((sum, section) => sum + section.live.length + section.facts.filter((fact) => fact.visibility === "tutti").length, 0);
}

/**
 * L'avviso dell'ok ai fornitori sulla pagina (§6.3): solo se c'è qualcosa da leggere, o un «In breve» che senza l'ok
 * non si può scrivere.
 */
export function consentNoticeNeeded(i: { unreadSources: number; brief: MemoryView["brief"]; material: number }): boolean {
  return i.unreadSources > 0 || (i.brief === null && i.material >= CONTEXT_LIMITS.briefMinItems);
}

// ─── «Aggiungi appunti» ──────────────────────────────────────────────

/** Il titolo proposto: la prima riga non vuota degli appunti, al massimo 80 caratteri, senza segni di elenco in testa. */
export const PROPOSED_TITLE_MAX = 80;
export function proposedTitle(body: string): string {
  const first = String(body ?? "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^[\s#>*\-–—•]+/, "").replace(/\s+/g, " ").trim())
    .find((line) => line.length > 0);
  if (!first) return "";
  if (first.length <= PROPOSED_TITLE_MAX) return first;
  const cut = first.slice(0, PROPOSED_TITLE_MAX);
  const space = cut.lastIndexOf(" ");
  return (space >= PROPOSED_TITLE_MAX / 2 ? cut.slice(0, space) : cut).trim();
}

/** Il titolo di un file: il nome senza estensione, con spazi al posto di trattini bassi. */
export function titleFromFileName(name: string): string {
  const base = String(name ?? "").replace(/^.*[\\/]/, "");
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  return stem.replace(/[_]+/g, " ").replace(/\s+/g, " ").trim().slice(0, CONTEXT_LIMITS.titleMax);
}

/** L'estensione di un file, in minuscolo, senza il punto. */
export function fileExtension(name: string): string {
  const base = String(name ?? "").replace(/^.*[\\/]/, "");
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

/** I file che diventano appunti nel browser, e quelli che si caricano come documento (§7.3, §10.2). */
const TEXT_EXTENSIONS = new Set(["txt", "md"]);
const DOCUMENT_EXTENSIONS = new Set(["pdf", "docx", "xlsx", "pptx", "csv", "tsv"]);
/** Per il campo `accept` dei file. */
export const ACCEPTED_FILES = ".txt,.md,.pdf,.docx,.xlsx,.pptx,.csv,.tsv";
/** I documenti che si caricano da «Carica documento» (anche i file di testo, che lì restano documenti). */
export const ACCEPTED_DOCUMENTS = ".pdf,.docx,.xlsx,.pptx,.csv,.tsv,.txt,.md";

export type DroppedFile = { kind: "testo" } | { kind: "documento" } | { kind: "rifiutato"; message: string };
/** Che cosa fare di un file: un testo si legge nel browser, un documento si carica (fino a 4 MB), il resto no. */
export function droppedFileKind(file: { name: string; size: number }): DroppedFile {
  const extension = fileExtension(file.name);
  if (!TEXT_EXTENSIONS.has(extension) && !DOCUMENT_EXTENSIONS.has(extension)) return { kind: "rifiutato", message: T.documents.badType };
  if (!(file.size > 0) || file.size > CONTEXT_LIMITS.uploadMaxBytes) return { kind: "rifiutato", message: T.documents.tooBig };
  return TEXT_EXTENSIONS.has(extension) ? { kind: "testo" } : { kind: "documento" };
}

/**
 * Il testo di un file `.txt` o `.md` trascinato in «Aggiungi appunti»: UTF-8 se lo è (senza il BOM), altrimenti
 * Windows-1252 («ANSI» di Blocco note e di Excel), come lo legge il caricamento dei documenti. `File.text()` legge solo
 * UTF-8: «Qualità» in Windows-1252 diventava «Qualit�».
 */
export function droppedText(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return decodeWindows1252(bytes);
  }
}

/** Un documento da caricare con «Carica documento»: i formati letti, fino a 4 MB. */
export function uploadableDocument(file: { name: string; size: number }): { ok: true } | { ok: false; message: string } {
  const extension = fileExtension(file.name);
  if (!TEXT_EXTENSIONS.has(extension) && !DOCUMENT_EXTENSIONS.has(extension)) return { ok: false, message: T.documents.badType };
  if (!(file.size > 0) || file.size > CONTEXT_LIMITS.uploadMaxBytes) return { ok: false, message: T.documents.tooBig };
  return { ok: true };
}

const DECIMAL = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 1 });
/** «1,2 MB», «340 KB», «12 B». */
export function fileSizeText(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${DECIMAL.format(bytes / (1024 * 1024))} MB`;
}

/** Il tipo di un documento a schermo: l'estensione del file, in maiuscolo («PDF», «DOCX»). */
export function fileTypeText(fileName: string): string {
  return fileExtension(fileName).toUpperCase();
}

export interface NoteDraftErrors {
  body?: string;
  title?: string;
  occurredOn?: string;
  link?: string;
}
/** I controlli del browser prima di salvare (gli stessi limiti di `addContextNote`, che li rifà). Senza file servono gli appunti. */
export function noteDraftErrors(draft: { body: string; title: string; occurredOn: string; link: string; hasFile: boolean }): NoteDraftErrors {
  const errors: NoteDraftErrors = {};
  const body = draft.body.trim();
  if (!draft.hasFile) {
    if (body.length < CONTEXT_LIMITS.bodyMin) errors.body = T.add.tooShort;
    else if (body.length > CONTEXT_LIMITS.bodyMax) errors.body = T.add.tooLong;
  }
  const title = draft.title.replace(/\s+/g, " ").trim();
  if (title.length < CONTEXT_LIMITS.titleMin) errors.title = T.add.titleMissing;
  else if (title.length > CONTEXT_LIMITS.titleMax) errors.title = T.errors.tooLong(CONTEXT_LIMITS.titleMax);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.occurredOn.trim())) errors.occurredOn = T.add.dateMissing;
  const link = draft.link.trim();
  if (link && (!/^https:\/\//.test(link) || link.length > CONTEXT_LIMITS.linkMax)) errors.link = T.add.linkInvalid;
  return errors;
}

/** Le fasi di «Aggiungi appunti»: il modulo, il salvataggio, la lettura, l'esito. */
export type AddNotesPhase = "modulo" | "salvo" | "leggo" | "fatto";
/**
 * Che cosa fa «Chiudi» (o un clic fuori, o Esc) su «Aggiungi appunti»: prima di salvare tiene quello che è scritto per
 * la prossima apertura; dopo il salvataggio la pagina si aggiorna (l'appunto c'è) e la finestra riparte vuota, e una
 * risposta arrivata dopo non la tocca più.
 */
export function addNotesClose(phase: AddNotesPhase): { keepDraft: boolean; refresh: boolean } {
  return phase === "modulo" ? { keepDraft: true, refresh: false } : { keepDraft: false, refresh: true };
}

// ─── La lettura ──────────────────────────────────────────────────────

/** A che punto è la lettura, a schermo. `retry`: c'è «Riprova» (non dopo un rifiuto: non si riprova da soli). */
export type ReadMessage = { text: string; retry: boolean; tone: "fatto" | "attesa" | "problema" };
export function readOutcomeMessage(outcome: ReadOutcome): ReadMessage | null {
  switch (outcome.status) {
    case "letto":
      return outcome.proposals > 0 ? null : { text: T.add.nothingNew, retry: false, tone: "fatto" };
    case "in_corso":
      return { text: T.page.readingOf(Math.min(outcome.partsRead + 1, outcome.partsTotal), outcome.partsTotal), retry: false, tone: "attesa" };
    case "ok_mancante":
      return { text: T.add.savedNoConsent, retry: false, tone: "attesa" };
    case "in_lettura":
      return { text: T.read.busy, retry: false, tone: "attesa" };
    case "rifiuto":
      return { text: T.read.refused, retry: false, tone: "problema" };
    case "tempo":
      return { text: T.read.timeout, retry: true, tone: "problema" };
    case "errore":
      return { text: T.read.failed, retry: true, tone: "problema" };
    case "limite":
      return { text: T.read.limit, retry: false, tone: "problema" };
  }
}

/** Il messaggio di una risposta d'errore di una rotta (`{ error, message }`): mai un codice interno a schermo. */
export function responseMessage(body: unknown, fallback: string = T.errors.retry): string {
  const value = body !== null && typeof body === "object" ? (body as Record<string, unknown>) : {};
  for (const key of ["message", "error"] as const) {
    const text = value[key];
    // Un codice («dati_non_validi», «file_troppo_grande») non è una frase: non si mostra.
    if (typeof text === "string" && text.trim().length > 0 && /\s/.test(text.trim()) && !/^[a-z_]+$/.test(text.trim())) return text.trim();
  }
  return fallback;
}
