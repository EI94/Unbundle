/**
 * Blocchi delle voci (PIANO §3.5, D9, D32, D38).
 *
 * Una voce è bloccata se la chiave del blocco sta nel suo `blocked_by` esplicito
 * oppure se la voce corrisponde allo scope del blocco. La voce resta `bloccata`
 * finché anche uno solo dei suoi blocchi è `attivo` o `permanente`; quando
 * l'ultimo si scioglie torna `da_chiedere` da sola (riga 27 di `item-state.ts`).
 *
 * Privacy prima di tutto:
 * - `a8` copre sempre le classi di rango ≥ `personale` e la disponibilità
 *   `dopo_a8`, anche se il template se ne dimentica [D9];
 * - `sanitario` è permanente e copre `escluso_sanitario` su **tutti** i tipi di
 *   voce: non si scioglie mai;
 * - una riga `uc_item_blockers` di un blocco attivo o permanente non si cancella
 *   mai (lo impone anche il trigger `uc_item_blockers_keep`);
 * - riclassificare una voce ricalcola i blocchi nello stesso batch; la classe
 *   privacy si abbassa solo con la firma dell'approvatore privacy.
 *
 * Modulo puro: import relativi `.ts`, nessun accesso a DB o ambiente.
 */
import { isIsoDate } from "./freshness.ts";
import { sha256Hex } from "./gates.ts";
import { caseRoleAllowedFor } from "./lateral-space.ts";
import { actorClasses, approvalsComplete } from "./permissions.ts";
import { fail, ok, type Actor, type Approval, type Json, type Result, type UserContext } from "./types.ts";
import {
  PERIMETERS,
  PRIVACY_CLASSES,
  isVocab,
  type BlockerStatus,
  type ItemBlockerOrigin,
  type ItemKind,
  type ItemStatus,
  type Perimeter,
  type PrivacyClass,
} from "./vocab.ts";

// ── Definizioni ───────────────────────────────────────────────────────

/** Quali voci un blocco prende in automatico (`uc_blockers.scope`). */
export interface BlockerScope {
  privacyClasses: PrivacyClass[];
  /** Token di disponibilità: basta che la voce ne abbia uno. */
  availability: string[];
  perimeters: Perimeter[];
  /** Il blocco riguarda anche l'uso di dati reali (dataset, casi di prova). */
  realData: boolean;
}

export interface BlockerDef {
  key: string;
  label?: string;
  scope: BlockerScope;
  permanent: boolean;
  /** Ripiego ammesso, testo dal template (es. un export al posto del collegamento). */
  fallbackAllowed?: string | null;
}

/** Fatti della voce che decidono i blocchi. `kind` non esclude nulla: il lucchetto sanitario vale per tutti i tipi. */
export interface ItemBlockerFacts {
  kind: ItemKind;
  privacyClass: PrivacyClass;
  availability: readonly string[];
  perimeter: Perimeter | null;
  /** `blocked_by` del template. */
  explicitBlockedBy: readonly string[];
}

export const A8_BLOCKER_KEY = "a8";
export const HEALTH_BLOCKER_KEY = "sanitario";

/** Classi di rango ≥ `personale` (dalla più restrittiva). */
export const A8_PRIVACY_CLASSES: readonly PrivacyClass[] = PRIVACY_CLASSES.slice(0, PRIVACY_CLASSES.indexOf("personale") + 1);

export const EMPTY_SCOPE: BlockerScope = Object.freeze({ privacyClasses: [], availability: [], perimeters: [], realData: false }) as BlockerScope;

/**
 * Scope minimo dei blocchi noti [D9]: vale anche se il template lo dichiara più
 * stretto. `fuori_foundation`, `decisione_board` e `accesso_sistema` vengono
 * dal template; `costi_art_8_4` non ha scope (solo blocco manuale).
 */
export const MINIMUM_SCOPES: Readonly<Record<string, BlockerScope>> = {
  [A8_BLOCKER_KEY]: { privacyClasses: [...A8_PRIVACY_CLASSES], availability: ["dopo_a8"], perimeters: [], realData: true },
  [HEALTH_BLOCKER_KEY]: { privacyClasses: ["escluso_sanitario"], availability: [], perimeters: [], realData: false },
};

/** Blocchi che ogni caso ha sempre, anche se il template non li dichiara. */
export const MANDATORY_BLOCKERS: readonly BlockerDef[] = [
  { key: A8_BLOCKER_KEY, label: "Scheda A.8 approvata per iscritto e titolo sui dati", scope: MINIMUM_SCOPES[A8_BLOCKER_KEY], permanent: false },
  { key: HEALTH_BLOCKER_KEY, label: "Dati sanitari: mai", scope: MINIMUM_SCOPES[HEALTH_BLOCKER_KEY], permanent: true },
];

const TOKEN = /^[a-z0-9_]{1,60}$/;

function uniq<T>(values: Iterable<T>): T[] {
  return [...new Set(values)];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Scope da `uc_blockers.scope` (jsonb `{privacy_classes, availability,
 * perimeters, real_data}`). I valori fuori vocabolario si scartano.
 */
export function parseBlockerScope(raw: unknown): BlockerScope {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    privacyClasses: uniq(stringArray(o.privacy_classes).filter((v): v is PrivacyClass => isVocab(PRIVACY_CLASSES, v))),
    availability: uniq(stringArray(o.availability).filter((v) => TOKEN.test(v))),
    perimeters: uniq(stringArray(o.perimeters).filter((v): v is Perimeter => isVocab(PERIMETERS, v))),
    realData: o.real_data === true,
  };
}

/** Scope per la colonna jsonb (snake_case). */
export function blockerScopeToJson(scope: BlockerScope): Json {
  return {
    privacy_classes: [...scope.privacyClasses],
    availability: [...scope.availability],
    perimeters: [...scope.perimeters],
    real_data: scope.realData,
  };
}

/** Scope effettivo: quello del template unito al minimo della chiave. */
export function effectiveScope(def: Pick<BlockerDef, "key" | "scope">): BlockerScope {
  const min = MINIMUM_SCOPES[def.key];
  if (!min) return def.scope;
  return {
    privacyClasses: uniq([...def.scope.privacyClasses, ...min.privacyClasses]),
    availability: uniq([...def.scope.availability, ...min.availability]),
    perimeters: uniq([...def.scope.perimeters, ...min.perimeters]),
    realData: def.scope.realData || min.realData,
  };
}

/** `sanitario` è sempre permanente, qualunque cosa dica il template. */
export function isPermanentBlocker(def: Pick<BlockerDef, "key" | "permanent">): boolean {
  return def.permanent || def.key === HEALTH_BLOCKER_KEY;
}

/** Stato alla creazione del caso: `permanente` o `attivo`. */
export function initialBlockerStatus(def: Pick<BlockerDef, "key" | "permanent">): BlockerStatus {
  return isPermanentBlocker(def) ? "permanente" : "attivo";
}

/** Aggiunge `a8` e `sanitario` se il template non li ha. */
export function ensureMandatoryBlockers(defs: readonly BlockerDef[]): BlockerDef[] {
  const keys = new Set(defs.map((d) => d.key));
  return [...defs, ...MANDATORY_BLOCKERS.filter((d) => !keys.has(d.key))];
}

/** Chiavi `blocked_by` che non corrispondono a nessun blocco del caso (errore del template). */
export function unknownBlockerKeys(explicitBlockedBy: readonly string[], defs: readonly BlockerDef[]): string[] {
  const keys = new Set(defs.map((d) => d.key));
  return uniq(explicitBlockedBy.filter((k) => !keys.has(k)));
}

// ── Quali blocchi ha una voce ─────────────────────────────────────────

/** La voce corrisponde allo scope? Classe, uno qualsiasi dei token di disponibilità, perimetro. */
export function itemMatchesScope(item: Pick<ItemBlockerFacts, "privacyClass" | "availability" | "perimeter">, scope: BlockerScope): boolean {
  if (scope.privacyClasses.includes(item.privacyClass)) return true;
  if (item.availability.some((t) => scope.availability.includes(t))) return true;
  return item.perimeter !== null && scope.perimeters.includes(item.perimeter);
}

/**
 * Collegamenti voce → blocco, nell'ordine dei blocchi: `template` se la chiave è
 * nel `blocked_by` esplicito, altrimenti `scope`. Valgono qualunque sia lo stato
 * del blocco: è lo stato a dire se la voce è bloccata adesso.
 */
export function blockerLinksForItem(item: ItemBlockerFacts, defs: readonly BlockerDef[]): { key: string; origin: Extract<ItemBlockerOrigin, "template" | "scope"> }[] {
  const out: { key: string; origin: "template" | "scope" }[] = [];
  const seen = new Set<string>();
  for (const def of defs) {
    if (seen.has(def.key)) continue;
    if (item.explicitBlockedBy.includes(def.key)) out.push({ key: def.key, origin: "template" });
    else if (itemMatchesScope(item, effectiveScope(def))) out.push({ key: def.key, origin: "scope" });
    else continue;
    seen.add(def.key);
  }
  return out;
}

/** Chiavi dei blocchi che riguardano la voce (PIANO §3.5). */
export function blockerKeysForItem(item: ItemBlockerFacts, defs: readonly BlockerDef[]): string[] {
  return blockerLinksForItem(item, defs).map((l) => l.key);
}

/** `attivo` e `permanente` bloccano; `sciolto` no. */
export function isActiveBlockerStatus(status: BlockerStatus): boolean {
  return status === "attivo" || status === "permanente";
}

/** Chiavi che bloccano adesso. Una chiave senza stato noto conta come attiva (prudenza). */
export function activeBlockerKeys(keys: readonly string[], statusByKey: ReadonlyMap<string, BlockerStatus>): string[] {
  return keys.filter((k) => {
    const s = statusByKey.get(k);
    return s === undefined || isActiveBlockerStatus(s);
  });
}

/** Una riga `uc_item_blockers` si cancella solo se il blocco è sciolto (trigger `uc_item_blockers_keep`). */
export function canDeleteItemBlockerLink(status: BlockerStatus): boolean {
  return status === "sciolto";
}

/** Si possono usare dati reali (dataset, casi di prova pseudonimizzati)? Solo con i blocchi `real_data` sciolti. */
export function realDataAllowed(blockers: readonly { def: Pick<BlockerDef, "key" | "scope">; status: BlockerStatus }[]): boolean {
  return blockers.every((b) => !effectiveScope(b.def).realData || b.status === "sciolto");
}

// ── Sblocco e riattivazione ───────────────────────────────────────────

export interface ItemBlockerLink {
  itemId: string;
  blockerId: string;
}

/**
 * Voci da portare a `da_chiedere` quando il blocco si scioglie: quelle collegate
 * al blocco, oggi `bloccata`, senza nessun altro blocco `attivo` o `permanente`
 * (uno stato sconosciuto conta come attivo).
 */
export function itemsToUnblock(i: {
  resolvedBlockerId: string;
  links: readonly ItemBlockerLink[];
  blockerStatus: ReadonlyMap<string, BlockerStatus>;
  itemStatus: ReadonlyMap<string, ItemStatus>;
}): string[] {
  const byItem = new Map<string, string[]>();
  for (const l of i.links) byItem.set(l.itemId, [...(byItem.get(l.itemId) ?? []), l.blockerId]);
  const out: string[] = [];
  for (const [itemId, blockerIds] of byItem) {
    if (!blockerIds.includes(i.resolvedBlockerId)) continue;
    if (i.itemStatus.get(itemId) !== "bloccata") continue;
    const stillBlocked = blockerIds.some((b) => b !== i.resolvedBlockerId && i.blockerStatus.get(b) !== "sciolto");
    if (!stillBlocked) out.push(itemId);
  }
  return out;
}

/**
 * Voci da portare a `bloccata` quando un blocco torna attivo (o una voce riceve
 * un blocco manuale): quelle collegate, tranne le `non_applicabile` e quelle già
 * bloccate (righe 3, 9, 13, 25, 30).
 */
export function itemsToBlock(i: { reactivatedBlockerId: string; links: readonly ItemBlockerLink[]; itemStatus: ReadonlyMap<string, ItemStatus> }): string[] {
  const out = new Set<string>();
  for (const l of i.links) {
    if (l.blockerId !== i.reactivatedBlockerId) continue;
    const s = i.itemStatus.get(l.itemId);
    if (s === undefined || s === "bloccata" || s === "non_applicabile") continue;
    out.add(l.itemId);
  }
  return [...out];
}

/** Effetti da eseguire nello stesso batch. */
export type BlockerSideEffect =
  /** Voci da `itemsToUnblock` a `da_chiedere`, un evento per voce. */
  | "sblocca_voci"
  /** Campanella LS «Richieste in bozza pronte da inviare». */
  | "campanella_bozze_pronte"
  /** Voci da `itemsToBlock` a `bloccata`, `request_item` a `riassegnata`. */
  | "blocca_voci"
  /** Campanella a ls_lead: nessuna sospensione automatica del caso. */
  | "campanella_ls_lead"
  /** Zona personale richiusa: tutti i `personal_zone_access` tornano false. */
  | "chiudi_zona_personale";

/** Prove scritte richieste per sciogliere un blocco. Mai nomi di persone: solo codici, date e file. */
export type BlockerEvidence = Record<string, Json>;

const ROLE_KEY = /^[a-z][a-z0-9_]{1,59}$/;
const MIN_TEXT = 10;

function nonEmpty(v: unknown, max = 500): v is string {
  return typeof v === "string" && v.trim().length > 0 && v.length <= max;
}

/**
 * Controlla le prove (`evidence`) per la chiave del blocco:
 * - `a8`: `{documento, versione, data, approvatori_per_ruolo[], file_id, titolo_art_15_2: true, regione_dati_verificata: true, accesso_zona_personale: [user_id]}`;
 * - `decisione_board`, `fuori_foundation`: file del verbale o dell'email e data;
 * - `costi_art_8_4`: autorizzazione scritta (file);
 * - `accesso_sistema`: descrizione dell'accesso e data;
 * - altre chiavi: file o descrizione, e data.
 * `approvatori_per_ruolo` contiene chiavi di ruolo, non nomi.
 */
export function checkBlockerEvidence(key: string, evidence: unknown): Result<BlockerEvidence> {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return fail("prove_mancanti", "Mancano le prove per sciogliere il blocco.");
  const e = evidence as Record<string, unknown>;
  const fileId = nonEmpty(e.file_id, 80);
  const date = isIsoDate(e.data);
  const description = typeof e.descrizione === "string" && e.descrizione.trim().length >= MIN_TEXT && e.descrizione.length <= 2000;
  switch (key) {
    case A8_BLOCKER_KEY: {
      if (!nonEmpty(e.documento) || !nonEmpty(e.versione, 40) || !date || !fileId) {
        return fail("prove_mancanti", "Servono documento, versione, data e file della scheda A.8.");
      }
      const approvers = e.approvatori_per_ruolo;
      if (!Array.isArray(approvers) || approvers.length === 0 || !approvers.every((r) => typeof r === "string" && ROLE_KEY.test(r))) {
        return fail("prove_mancanti", "Indica i ruoli che hanno approvato la scheda A.8 (solo ruoli, non nomi).");
      }
      if (e.titolo_art_15_2 !== true) return fail("titolo_dati_mancante", "Manca il titolo sui dati del cliente (art. 15.2).");
      if (e.regione_dati_verificata !== true) return fail("regione_non_verificata", "Conferma che la regione dei dati è verificata.");
      const access = e.accesso_zona_personale;
      if (!Array.isArray(access) || !access.every((u) => typeof u === "string" && u.length > 0 && u.length <= 80)) {
        return fail("prove_mancanti", "Indica chi può accedere alla zona personale (anche nessuno).");
      }
      break;
    }
    case "decisione_board":
    case "fuori_foundation":
      if (!fileId || !date) return fail("prove_mancanti", "Carica il verbale o l'email dell'AI Board e indica la data.");
      break;
    case "costi_art_8_4":
      if (!fileId) return fail("prove_mancanti", "Carica l'autorizzazione scritta dei costi (art. 8.4).");
      break;
    case "accesso_sistema":
      if (!description || !date) return fail("prove_mancanti", "Descrivi l'accesso al sistema e indica la data.");
      break;
    default:
      if ((!fileId && !description) || !date) return fail("prove_mancanti", "Carica un file o descrivi la prova, e indica la data.");
  }
  return ok(e as BlockerEvidence);
}

/** JSON con le chiavi ordinate a ogni livello: la stessa prova dà sempre lo stesso testo. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const o = value as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
    .join(",")}}`;
}

/**
 * Impronta delle prove A.8 (SHA-256 del JSON canonico). Le due firme valgono
 * solo sulla stessa prova: il comando la passa come `textHash` ed
 * `expectedTextHash` di `addSignature(purpose: "a8")`, così l'approvatore
 * privacy firma esattamente la scheda (e l'elenco `accesso_zona_personale`)
 * firmata da Lateral Space.
 */
export function blockerEvidenceHash(evidence: BlockerEvidence): string {
  return sha256Hex(canonicalJson(evidence));
}

function isLsLead(actor: Actor, user?: UserContext | null): boolean {
  return actorClasses(actor, user).has("ls_lead");
}

function isPrivacyApprover(actor: Actor, user?: UserContext | null): boolean {
  if (actor.type === "owner_link") return actor.designation === "privacy";
  if (actor.type !== "utente" || !actor.roles.includes("approvatore_privacy")) return false;
  return !user || (user.userId === actor.userId && caseRoleAllowedFor(user, "approvatore_privacy"));
}

/**
 * Si può sciogliere il blocco? Un blocco `permanente` (e `sanitario`) mai.
 * - `a8`: prove complete e due firme, `ls_lead` e approvatore privacy (utente
 *   non Lateral Space o firmatario privacy designato dal link), entrambe con
 *   `text_hash = blockerEvidenceHash(prove)`: una firma su prove diverse non
 *   conta. Con una sola firma il blocco resta `attivo` e mostra «In attesa della
 *   conferma del cliente» (`complete = false`). `approvals` sono le firme già
 *   raccolte, compresa quella appena aggiunta con `addSignature(purpose: "a8")`.
 * - Gli altri: prove complete e `ls_lead`.
 */
export function checkResolveBlocker(i: {
  def: Pick<BlockerDef, "key" | "permanent">;
  status: BlockerStatus;
  evidence: unknown;
  approvals: readonly Approval[];
  actor: Actor;
  user?: UserContext | null;
}): Result<{
  complete: boolean;
  waitingFor: "lateral_space" | "cliente" | null;
  message: string | null;
  evidence: BlockerEvidence;
  /** Impronta delle prove, da firmare (`textHash`) per `a8`. */
  evidenceHash: string;
  sideEffects: BlockerSideEffect[];
}> {
  if (isPermanentBlocker(i.def) || i.status === "permanente") {
    return fail("blocco_permanente", "Questo blocco non si scioglie mai.");
  }
  if (i.status !== "attivo") return fail("blocco_non_attivo", "Il blocco è già sciolto.");
  const isA8 = i.def.key === A8_BLOCKER_KEY;
  const lsLead = isLsLead(i.actor, i.user);
  if (!lsLead && !(isA8 && isPrivacyApprover(i.actor, i.user))) {
    return fail(
      "attore_non_ammesso",
      isA8 ? "La scheda A.8 la confermano il Responsabile del caso e l'approvatore privacy del cliente." : "Solo il Responsabile del caso scioglie questo blocco.",
    );
  }
  const evidence = checkBlockerEvidence(i.def.key, i.evidence);
  if (!evidence.ok) return evidence;
  const done: BlockerSideEffect[] = ["sblocca_voci", "campanella_bozze_pronte"];
  const evidenceHash = blockerEvidenceHash(evidence.value);
  if (!isA8) return ok({ complete: true, waitingFor: null, message: null, evidence: evidence.value, evidenceHash, sideEffects: done });
  const s = approvalsComplete(
    i.approvals.filter((a) => a.text_hash === evidenceHash),
    "a8",
  );
  if (s.complete) return ok({ complete: true, waitingFor: null, message: null, evidence: evidence.value, evidenceHash, sideEffects: done });
  const waitingFor = s.ls ? "cliente" : s.cliente ? "lateral_space" : "cliente";
  return ok({
    complete: false,
    waitingFor,
    message: waitingFor === "cliente" ? "In attesa della conferma del cliente" : "In attesa della firma del Responsabile del caso",
    evidence: evidence.value,
    evidenceHash,
    sideEffects: [],
  });
}

/**
 * Riattivazione (`sciolto → attivo`, es. scheda A.8 ritirata): solo ls_lead, con
 * motivo. Le voci collegate tornano `bloccata` (`itemsToBlock`); per `a8` la
 * zona personale si richiude. Nessuna sospensione automatica del caso.
 */
export function checkReactivateBlocker(i: {
  def: Pick<BlockerDef, "key" | "permanent">;
  status: BlockerStatus;
  actor: Actor;
  user?: UserContext | null;
  reason: string | null | undefined;
}): Result<{ sideEffects: BlockerSideEffect[] }> {
  if (i.status !== "sciolto") return fail("blocco_non_sciolto", "Il blocco è già attivo.");
  if (!isLsLead(i.actor, i.user)) return fail("attore_non_ammesso", "Solo il Responsabile del caso riattiva un blocco.");
  if (!i.reason || i.reason.trim().length < 3) return fail("motivo_obbligatorio", "Scrivi il motivo: resta negli eventi.");
  const sideEffects: BlockerSideEffect[] = ["blocca_voci", "campanella_ls_lead"];
  if (i.def.key === A8_BLOCKER_KEY) sideEffects.push("chiudi_zona_personale");
  return ok({ sideEffects });
}

/**
 * Blocco manuale su una voce (es. `costi_art_8_4`, che non ha scope): solo
 * ls_lead. La riga ha `origin = 'manuale'`; se il blocco è attivo la voce passa a
 * `bloccata` (righe 3, 9, 13, 25, 30), salvo se è non applicabile.
 */
export function checkManualBlockerLink(i: {
  blockerStatus: BlockerStatus;
  itemStatus: ItemStatus;
  alreadyLinked: boolean;
  actor: Actor;
  user?: UserContext | null;
}): Result<{ blockNow: boolean }> {
  if (!isLsLead(i.actor, i.user)) return fail("attore_non_ammesso", "Solo il Responsabile del caso blocca una voce a mano.");
  if (i.alreadyLinked) return fail("blocco_gia_presente", "La voce ha già questo blocco.");
  return ok({ blockNow: isActiveBlockerStatus(i.blockerStatus) && i.itemStatus !== "bloccata" && i.itemStatus !== "non_applicabile" });
}

// ── Riclassificazione (D38) ───────────────────────────────────────────

const privacyRank = (c: PrivacyClass) => PRIVACY_CLASSES.indexOf(c);

export interface ExistingBlockerLink {
  key: string;
  origin: ItemBlockerOrigin;
}

/**
 * Nuova classificazione di una voce (`addItem`, `updateItemMeta`): ricalcola i
 * blocchi nello stesso batch.
 *
 * - La classe privacy si può solo alzare; abbassarla richiede ls_lead più la
 *   firma dell'approvatore privacy (`privacyLoweringApproved`), evento
 *   `voce.classe_privacy_cambiata` con soli codici.
 * - Con `a8` o `sanitario` attivo sulla voce non si tolgono token di
 *   disponibilità e non si cambia il perimetro.
 * - Le righe di blocchi attivi o permanenti non si cancellano mai; le righe
 *   manuali restano; si tolgono solo righe `template`/`scope` di blocchi sciolti
 *   che non corrispondono più.
 * - `block`: la voce deve passare a `bloccata` (righe 3, 9, 13, 25, 30).
 *   Per una voce nuova (`before = null`) `initialStatus` dice come nasce.
 */
export function checkReclassification(i: {
  before: ItemBlockerFacts | null;
  after: ItemBlockerFacts;
  itemStatus: ItemStatus | null;
  existingLinks: readonly ExistingBlockerLink[];
  defs: readonly BlockerDef[];
  blockerStatus: ReadonlyMap<string, BlockerStatus>;
  privacyLoweringApproved?: boolean;
}): Result<{
  add: { key: string; origin: "template" | "scope" }[];
  remove: string[];
  keys: string[];
  activeKeys: string[];
  block: boolean;
  initialStatus: ItemStatus | null;
  privacyChange: "alzata" | "abbassata" | null;
}> {
  const { before, after } = i;
  let privacyChange: "alzata" | "abbassata" | null = null;
  if (before && before.privacyClass !== after.privacyClass) {
    privacyChange = privacyRank(after.privacyClass) < privacyRank(before.privacyClass) ? "alzata" : "abbassata";
    if (privacyChange === "abbassata" && !i.privacyLoweringApproved) {
      return fail("classe_privacy_abbassata", "La classe privacy si abbassa solo con la firma dell'approvatore privacy.");
    }
  }
  if (before) {
    const lockedKeys = activeBlockerKeys(
      i.existingLinks.map((l) => l.key).filter((k) => k === A8_BLOCKER_KEY || k === HEALTH_BLOCKER_KEY),
      i.blockerStatus,
    );
    if (lockedKeys.length > 0) {
      if (before.availability.some((t) => !after.availability.includes(t))) {
        return fail("blocco_privacy_attivo", "Con il blocco privacy attivo non si tolgono indicazioni di disponibilità.");
      }
      if (before.perimeter !== after.perimeter) {
        return fail("blocco_privacy_attivo", "Con il blocco privacy attivo non si cambia il perimetro.");
      }
    }
  }
  const computed = blockerLinksForItem(after, i.defs);
  const computedKeys = new Set(computed.map((l) => l.key));
  const existingKeys = new Set(i.existingLinks.map((l) => l.key));
  const remove = uniq(
    i.existingLinks
      .filter((l) => l.origin !== "manuale" && !computedKeys.has(l.key) && i.blockerStatus.get(l.key) === "sciolto")
      .map((l) => l.key),
  );
  const add = computed.filter((l) => !existingKeys.has(l.key));
  const keys = uniq([...i.existingLinks.map((l) => l.key).filter((k) => !remove.includes(k)), ...add.map((l) => l.key)]);
  const active = activeBlockerKeys(keys, i.blockerStatus);
  const status = i.itemStatus;
  return ok({
    add,
    remove,
    keys,
    activeKeys: active,
    block: status !== null && active.length > 0 && status !== "bloccata" && status !== "non_applicabile",
    initialStatus: status === null ? (active.length > 0 ? "bloccata" : "da_chiedere") : null,
    privacyChange,
  });
}
