/**
 * Le regole dopo la risposta del modello (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md §4.2): ogni proposta
 * passa da qui prima di essere salvata. Il modello propone, il codice decide che cosa può restare:
 *
 * 1. il testo si pulisce; oltre 200 caratteri la proposta va accorciata (`lungo`), oltre 400 si taglia;
 * 2. dati sanitari e discriminatori non restano; un nome, un contatto, un codice fiscale, una data di nascita restano
 *    da correggere (`issue`);
 * 3. una citazione che gli appunti non contengono non si salva, e la proposta diventa «dedotto»;
 * 4. un riferimento a un fatto che non c'è fa della proposta un fatto nuovo;
 * 5. lo stesso testo di un fatto in memoria è una riconferma; una frase già proposta non si ripropone, e nemmeno il
 *    passaggio di una proposta che la persona ha corretto (la stessa citazione);
 * 6. un cambiamento o un conflitto su un fatto «Solo Lateral Space» resta «Solo Lateral Space» (si chiude, non si apre),
 *    e così una proposta con la frase di un fatto «Solo Lateral Space», anche di uno che il prompt non aveva;
 * 7. sezione nulla solo per impegni e domande;
 * 8. un impegno ha sempre una parte; una data è una data vera;
 * 9. codici, riferimenti ed entità che non stanno negli elenchi si scartano;
 * 10. al massimo 25 proposte.
 *
 * Niente di quello che c'è scritto negli appunti cambia queste regole. Modulo puro.
 */
import { cut, entityKey, entityName, foldText, normalizeStatement, oneLine } from "../normalize.ts";
import { isHardIssue, scanNote, scanPersonalData, scanStatement } from "../scan.ts";
import {
  CONTEXT_LIMITS,
  LINKED_ENTITY_TYPES,
  type Basis,
  type CommitmentParty,
  type ContextSection,
  type ContextVisibility,
  type ProposalEntity,
  type ProposalIssue,
  type ProposalKind,
  type ProposalRelation,
  type SkippedCounts,
} from "../vocab.ts";
import type { ContextReadOutput, ContextReadProposal } from "./schema.ts";

export interface ReconcileInput {
  output: ContextReadOutput;
  /** Tutto l'appunto, per controllare le citazioni. */
  sourceText: string;
  facts: Array<{ ref: string; id: string; statement: string; visibility: ContextVisibility }>;
  questions: Array<{ ref: string; id: string }>;
  useCases: Array<{ code: string; id: string; title?: string }>;
  units: Array<{ ref: string; name: string; id: string }>;
  goals: Array<{ ref: string; title: string; id: string }>;
  already: string[];
  /**
   * Le citazioni delle proposte di questi appunti che la persona ha corretto (confermate, scartate o aperte). La frase
   * corretta è in `already`, quella del modello non c'è più: una proposta nuova con la stessa citazione è lo stesso
   * passaggio, già deciso, e non si ripropone.
   */
  editedQuotes?: string[];
  /**
   * I fatti «Solo Lateral Space» attivi del workspace, anche quelli che il prompt non aveva (la lettura di un documento
   * del cliente non li riceve): una proposta con la stessa frase resta «Solo Lateral Space».
   */
  lsFacts?: Array<{ id: string; statement: string }>;
  occurredOn: string;
}

/** Una proposta pronta da salvare: i campi di `context_proposals`, senza id e senza stato. */
export interface DraftProposal {
  kind: ProposalKind;
  statement: string;
  quote: string | null;
  basis: Basis;
  section: ContextSection | null;
  visibility: ContextVisibility;
  targetFactId: string | null;
  questionId: string | null;
  useCaseIds: string[];
  party: CommitmentParty | null;
  roleLabel: string | null;
  dueOn: string | null;
  entities: ProposalEntity[];
  relations: ProposalRelation[];
  issue: ProposalIssue | null;
}

export interface ReconcileResult {
  /** Nell'ordine degli appunti (quello della risposta). */
  proposals: DraftProposal[];
  skipped: SkippedCounts;
  /** Le proposte oltre il tetto di 25, scartate: va nel log (`proposte_oltre_il_tetto`). */
  overCap: number;
}

/**
 * «Dedotto» e conflitti non sono mai preselezionati; nemmeno una proposta da correggere, una proposta di una fonte del
 * cliente (`fromClient`, `isClientSource`) o una con la frase di un fatto «Solo Lateral Space» (`matchesLsOnly`): la
 * sceglie la persona. La preselezione non si salva.
 */
export function isPreselected(p: { basis: Basis; kind: ProposalKind; issue: ProposalIssue | null; fromClient?: boolean; matchesLsOnly?: boolean }): boolean {
  return p.basis === "detto" && p.kind !== "conflitto" && p.issue === null && p.fromClient !== true && p.matchesLsOnly !== true;
}

const FACT_KINDS: readonly ProposalKind[] = ["nuovo", "cambia", "conferma", "conflitto", "decisione"];
const TARGET_KINDS: readonly ProposalKind[] = ["cambia", "conferma", "conflitto"];
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Una data vera `AAAA-MM-GG` (il 30 febbraio non lo è), oppure null. */
export function realIsoDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = ISO_DATE.exec(value.trim());
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (year < 2000 || year > 2100) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? match[0] : null;
}

const count = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(99, Math.trunc(value))) : 0);
const refKey = (value: unknown): string => (typeof value === "string" ? value.trim().toUpperCase() : "");

/** L'ordine del tetto: conflitti, cambiamenti, fatti nuovi e decisioni detti, impegni, domande, riconferme, per ultimi i fatti dedotti. */
function capRank(p: DraftProposal): number {
  switch (p.kind) {
    case "conflitto":
      return 0;
    case "cambia":
      return 1;
    case "nuovo":
    case "decisione":
      return p.basis === "detto" ? 2 : 6;
    case "impegno":
      return 3;
    case "domanda":
      return 4;
    case "conferma":
      return 5;
  }
}

/** Il ruolo di un impegno o il «a chi chiedere» di una domanda: una riga, al massimo 80 caratteri, mai un dato di una persona. */
function roleOf(value: string | null): string | null {
  const role = cut(oneLine(value ?? ""), CONTEXT_LIMITS.roleLabelMax).trim();
  if (!role) return null;
  return scanPersonalData(role).ok ? role : null;
}

interface Lists {
  factsByRef: Map<string, ReconcileInput["facts"][number]>;
  factsByKey: Map<string, ReconcileInput["facts"][number]>;
  questionsByRef: Map<string, string>;
  useCasesByCode: Map<string, string>;
  useCasesByTitle: Map<string, { id: string }>;
  unitsByKey: Map<string, { id: string; name: string }>;
  goalsByKey: Map<string, { id: string; title: string }>;
}

function listsOf(input: ReconcileInput): Lists {
  const useCasesByTitle = new Map<string, { id: string }>();
  for (const u of input.useCases) if (u.title) useCasesByTitle.set(entityKey(u.title), { id: u.id });
  return {
    factsByRef: new Map(input.facts.map((f) => [refKey(f.ref), f])),
    factsByKey: new Map(input.facts.map((f) => [normalizeStatement(f.statement), f])),
    questionsByRef: new Map(input.questions.map((q) => [refKey(q.ref), q.id])),
    useCasesByCode: new Map(input.useCases.map((u) => [refKey(u.code), u.id])),
    useCasesByTitle,
    unitsByKey: new Map(input.units.flatMap((u) => [[entityKey(u.name), { id: u.id, name: u.name }], [refKey(u.ref).toLowerCase(), { id: u.id, name: u.name }]])),
    goalsByKey: new Map(input.goals.flatMap((g) => [[entityKey(g.title), { id: g.id, title: g.title }], [refKey(g.ref).toLowerCase(), { id: g.id, title: g.title }]])),
  };
}

/** Quante entità e quanti collegamenti tiene una proposta, al massimo. */
const ENTITIES_MAX = 12;

/**
 * Le entità di una proposta: quelle di Unbundle (unità, obiettivi, use case) solo se stanno negli elenchi, con il nome
 * dell'elenco e l'id della riga; le altre con il nome scritto dal modello, se non porta dati di una persona. `written`
 * dice a quale entità salvata corrisponde ogni nome scritto dal modello, per i collegamenti.
 */
function entitiesOf(raw: ContextReadProposal["entita"], lists: Lists, useCases: ReconcileInput["useCases"]): { entities: ProposalEntity[]; written: Map<string, ProposalEntity> } {
  const saved = new Map<string, ProposalEntity>();
  const written = new Map<string, ProposalEntity>();
  for (const item of Array.isArray(raw) ? raw : []) {
    const name = entityName(typeof item?.nome === "string" ? item.nome : "");
    if (!name) continue;
    const key = entityKey(name);
    let entity: ProposalEntity | null = null;
    if (item.tipo === "unita") {
      const unit = lists.unitsByKey.get(key);
      if (unit) entity = { name: entityName(unit.name), type: "unita", refId: unit.id };
    } else if (item.tipo === "obiettivo") {
      const goal = lists.goalsByKey.get(key);
      if (goal) entity = { name: entityName(goal.title), type: "obiettivo", refId: goal.id };
    } else if (item.tipo === "use_case") {
      const id = lists.useCasesByCode.get(refKey(name)) ?? lists.useCasesByTitle.get(key)?.id;
      const found = id ? useCases.find((u) => u.id === id) : undefined;
      if (found) entity = { name: entityName(found.title || found.code), type: "use_case", refId: found.id };
    } else if (!(LINKED_ENTITY_TYPES as readonly string[]).includes(item.tipo) && scanPersonalData(name).ok) {
      entity = { name, type: item.tipo };
    }
    if (!entity) continue;
    // Un nome solo per entità dentro la proposta: i collegamenti le citano per nome.
    const savedKey = entityKey(entity.name);
    const earlier = saved.get(savedKey);
    if (earlier && (earlier.type !== entity.type || earlier.refId !== entity.refId)) continue;
    const kept = earlier ?? (saved.size < ENTITIES_MAX ? entity : null);
    if (!kept) continue;
    saved.set(savedKey, kept);
    if (!written.has(key)) written.set(key, kept);
  }
  for (const [savedKey, entity] of saved) if (!written.has(savedKey)) written.set(savedKey, entity);
  return { entities: [...saved.values()], written };
}

/** I collegamenti di una proposta: solo tra due sue entità diverse, con i nomi salvati. */
function relationsOf(raw: ContextReadProposal["collegamenti"], written: ReadonlyMap<string, ProposalEntity>): ProposalRelation[] {
  const out = new Map<string, ProposalRelation>();
  for (const item of Array.isArray(raw) ? raw : []) {
    const from = written.get(entityKey(typeof item?.da === "string" ? item.da : ""));
    const to = written.get(entityKey(typeof item?.a === "string" ? item.a : ""));
    if (!from || !to || from === to) continue;
    out.set(`${from.type}:${entityKey(from.name)}|${item.verbo}|${to.type}:${entityKey(to.name)}`, { from: from.name, verb: item.verbo, to: to.name });
    if (out.size >= ENTITIES_MAX) break;
  }
  return [...out.values()];
}

export function reconcile(input: ReconcileInput): ReconcileResult {
  const lists = listsOf(input);
  const source = foldText(input.sourceText);
  const seen = new Set(input.already.map(normalizeStatement).filter(Boolean));
  const editedQuotes = new Set((input.editedQuotes ?? []).map(normalizeStatement).filter(Boolean));
  const lsOnly = new Set([...input.facts.filter((f) => f.visibility === "ls"), ...(input.lsFacts ?? [])].map((f) => normalizeStatement(f.statement)).filter(Boolean));
  const skipped = { persone: 0, sanitari: 0, altri_clienti: 0, clienti_del_cliente: 0 };
  const drafts: DraftProposal[] = [];
  const confirmedFacts = new Set<string>();

  for (const raw of Array.isArray(input.output?.proposte) ? input.output.proposte : []) {
    // 1. Testo.
    const full = oneLine(typeof raw?.testo === "string" ? raw.testo : "");
    if (!full) continue;
    const statement = cut(full, CONTEXT_LIMITS.proposalStatementMax).trim();
    let issue: ProposalIssue | null = full.length > CONTEXT_LIMITS.statementMax ? "lungo" : null;

    // 2. Controllo.
    const scan = scanStatement(statement);
    if (!scan.ok) {
      if (isHardIssue(scan.issue)) {
        if (scan.issue === "sanitario") skipped.sanitari += 1;
        else skipped.persone += 1;
        continue;
      }
      issue = scan.issue;
    }

    // 3. Citazione: mai una che gli appunti non contengono.
    let basis: Basis = raw.base === "detto" ? "detto" : "dedotto";
    let quote: string | null = cut(oneLine(typeof raw.citazione === "string" ? raw.citazione : ""), CONTEXT_LIMITS.quoteMax).trim() || null;
    if (quote && (!source.includes(foldText(quote)) || !scanNote(quote).ok)) quote = null;
    if (!quote) basis = "dedotto";
    // Il passaggio di una proposta che la persona ha già corretto: è già deciso, con le sue parole.
    if (quote && editedQuotes.has(normalizeStatement(quote))) continue;

    // 4. Riferimento al fatto.
    let kind: ProposalKind = raw.tipo;
    let target = TARGET_KINDS.includes(kind) ? (lists.factsByRef.get(refKey(raw.fattoRif)) ?? null) : null;
    if (TARGET_KINDS.includes(kind) && !target) {
      if (kind === "conferma") continue;
      kind = "nuovo";
    }

    // 5. Stesso testo.
    const key = normalizeStatement(statement);
    if (!key) continue;
    if (FACT_KINDS.includes(kind)) {
      const same = lists.factsByKey.get(key);
      if (same) {
        kind = "conferma";
        target = same;
      }
    }
    // Una riconferma vale per il fatto, con la sua frase: una volta sola, e non se questi appunti l'hanno già proposta.
    const seenKey = kind === "conferma" && target ? normalizeStatement(target.statement) : key;
    if (seen.has(seenKey) || (kind === "conferma" && target && confirmedFacts.has(target.id))) continue;

    // 6. Visibilità: si chiude, non si apre. La frase di un fatto «Solo Lateral Space» resta «Solo Lateral Space».
    let visibility: ContextVisibility = raw.visibilita === "tutti" ? "tutti" : "ls";
    if (target && target.visibility === "ls") visibility = "ls";
    if (kind === "conferma" && target) visibility = target.visibility;
    if (lsOnly.has(key) || lsOnly.has(seenKey)) visibility = "ls";

    // 7. Sezione.
    const loose = kind === "impegno" || kind === "domanda";
    const section: ContextSection | null = loose ? null : (raw.sezione ?? "azienda");

    // 8. Impegno.
    let party: CommitmentParty | null = null;
    let dueOn: string | null = null;
    if (kind === "impegno") {
      if (raw.parte === "nostra" || raw.parte === "cliente") party = raw.parte;
      else {
        party = "nostra";
        basis = "dedotto";
      }
      dueOn = realIsoDate(raw.entro);
    }
    const roleLabel = loose ? roleOf(raw.ruolo) : null;

    // 9. Use case, domanda, entità, collegamenti.
    const useCaseIds = [...new Set((Array.isArray(raw.useCase) ? raw.useCase : []).map((code) => lists.useCasesByCode.get(refKey(code))).filter((id): id is string => Boolean(id)))];
    const questionId = FACT_KINDS.includes(kind) && kind !== "conferma" ? (lists.questionsByRef.get(refKey(raw.domandaRif)) ?? null) : null;
    const named = loose || kind === "conferma" ? null : entitiesOf(raw.entita, lists, input.useCases);
    const entities = named ? named.entities : [];
    const relations = named && entities.length > 1 ? relationsOf(raw.collegamenti, named.written) : [];

    if (kind === "conferma" && target) confirmedFacts.add(target.id);
    seen.add(seenKey);
    drafts.push({
      kind,
      statement: kind === "conferma" && target ? cut(oneLine(target.statement), CONTEXT_LIMITS.proposalStatementMax) : statement,
      quote,
      basis,
      section,
      visibility,
      targetFactId: target ? target.id : null,
      questionId,
      useCaseIds,
      party,
      roleLabel,
      dueOn,
      entities,
      relations,
      issue: kind === "conferma" ? null : issue,
    });
  }

  // 10. Tetto: le prime 25 per importanza, salvate nell'ordine degli appunti.
  const kept = drafts
    .map((draft, index) => ({ draft, index }))
    .sort((a, b) => capRank(a.draft) - capRank(b.draft) || a.index - b.index)
    .slice(0, CONTEXT_LIMITS.proposalsPerCall)
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.draft);

  const reported = input.output?.nonRiportati;
  skipped.persone += count(reported?.persone);
  skipped.sanitari += count(reported?.sanitari);
  skipped.altri_clienti += count(reported?.altriClienti);
  skipped.clienti_del_cliente += count(reported?.clientiDelCliente);
  const out: SkippedCounts = {};
  for (const [name, value] of Object.entries(skipped) as Array<[keyof SkippedCounts, number]>) if (value > 0) out[name] = Math.min(999, value);

  return { proposals: kept, skipped: out, overCap: drafts.length - kept.length };
}

/** Somma due conteggi di passaggi non riportati (le parti di un appunto lungo). */
export function addSkipped(a: SkippedCounts, b: SkippedCounts): SkippedCounts {
  const out: SkippedCounts = {};
  const stored = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(999, Math.trunc(value))) : 0);
  for (const name of ["persone", "sanitari", "altri_clienti", "clienti_del_cliente"] as const) {
    const total = stored(a?.[name]) + stored(b?.[name]);
    if (total > 0) out[name] = Math.min(999, total);
  }
  return out;
}
