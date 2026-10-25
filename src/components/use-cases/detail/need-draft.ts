/**
 * Il modulo di un'esigenza nel capitolo «Cosa serve» della scheda (spec di Pierpaolo, 25/10/2026):
 * la bozza dei campi come testo, da e verso le esigenze lette (`NeedView`) e i corpi delle action
 * (`createNeedAction`, `updateNeedAction`). Modulo puro: lo usa il componente e lo provano i test.
 *
 * - Una bozza nuova parte dal tipo scelto, con lo stato di partenza del tipo.
 * - Cambiando tipo, uno stato che non vale più torna quello di partenza del tipo nuovo.
 * - La modifica manda solo i campi cambiati; un testo vuoto vale null.
 * - La validazione vera è del servizio (`validateNeedInput`, `validateNeedPatch`): qui solo il
 *   titolo obbligatorio, per non partire a vuoto.
 */
import {
  NEED_AVAILABILITIES,
  NEED_ERRORS,
  NEED_KINDS,
  NEED_OWNER_SIDES,
  defaultNeedStatus,
  isNeedStatusOf,
  type NeedAvailability,
  type NeedKind,
  type NeedOwnerSide,
  type NeedStatus,
  type NeedType,
  type NeedView,
} from "../../../lib/use-cases/needs.ts";

export interface NeedDraft {
  type: NeedType;
  kind: NeedKind;
  title: string;
  detail: string;
  ownerLabel: string;
  /** "" senza parte. */
  ownerSide: NeedOwnerSide | "";
  status: NeedStatus;
  /** "" senza «quando». Solo per i requisiti. */
  availability: NeedAvailability | "";
  /** `AAAA-MM-GG` oppure "". */
  dueOn: string;
  dueIsProposal: boolean;
  /** «Entro» a parole, quando non c'è una data: «entro fine mese». */
  dueLabel: string;
  /** Per chi è, a parole, oltre agli use case collegati. */
  forLabel: string;
}

export const NEED_FORM_TEXT = Object.freeze({
  title: "Cosa serve",
  empty: "Niente per ora.",
  requirements: "Requisiti",
  steps: "Prossimi passi",
  add: "Aggiungi",
  link: "Collega un'esigenza",
  edit: "Modifica",
  addTitle: "Aggiungi a «Cosa serve»",
  editTitle: "Modifica",
  linkTitle: "Collega un'esigenza che c'è già",
  linkDescription: "La stessa esigenza può servire a più use case.",
  linkChoice: "Esigenza",
  linkConfirm: "Collega",
  save: "Salva",
  type: "Tipo",
  what: "Che cosa",
  detail: "Dettagli",
  kind: "Di che cosa si tratta",
  owner: "Chi se ne occupa",
  ownerSide: "Da che parte",
  noSide: "Nessuna",
  status: "Stato",
  availability: "Quando serve",
  noAvailability: "Non detto",
  dueOn: "Entro",
  dueIsProposal: "Data da confermare",
  more: "Altro",
  dueLabel: "Entro, a parole",
  forLabel: "Per, a parole",
  alsoFor: "Anche per",
  unlink: "Scollega da questo use case",
  archive: "Archivia",
  archiveTitle: "Archivia l'esigenza",
  archiveDescription: "Esce da Priorità, dal pannello e dalle schede. Non si cancella.",
  archiveReason: "Perché la archivi?",
});

/** Una bozza nuova: requisito da chiedere, oppure passo proposto. */
export function emptyNeedDraft(type: NeedType = "requisito"): NeedDraft {
  return {
    type,
    kind: "altro",
    title: "",
    detail: "",
    ownerLabel: "",
    ownerSide: "",
    status: defaultNeedStatus(type),
    availability: "",
    dueOn: "",
    dueIsProposal: false,
    dueLabel: "",
    forLabel: "",
  };
}

/** La bozza di un'esigenza letta. */
export function draftFromNeed(need: NeedView): NeedDraft {
  return {
    type: need.type,
    kind: need.kind,
    title: need.title,
    detail: need.detail ?? "",
    ownerLabel: need.ownerLabel ?? "",
    ownerSide: need.ownerSide ?? "",
    status: need.status,
    availability: need.availability ?? "",
    dueOn: need.dueOn ?? "",
    dueIsProposal: need.dueIsProposal,
    dueLabel: need.dueLabel ?? "",
    forLabel: need.forLabel ?? "",
  };
}

/** Un altro tipo: lo stato resta se vale ancora, altrimenti riparte da quello del tipo. */
export function withNeedType(draft: NeedDraft, type: NeedType): NeedDraft {
  if (type === draft.type) return draft;
  return { ...draft, type, status: isNeedStatusOf(type, draft.status) ? draft.status : defaultNeedStatus(type) };
}

const text = (value: string): string | null => value.trim() || null;

/** I campi della bozza come li vuole il servizio: testi vuoti a null. */
function fieldsOf(draft: NeedDraft) {
  return {
    type: draft.type,
    kind: draft.kind,
    title: draft.title.trim(),
    detail: text(draft.detail),
    ownerLabel: text(draft.ownerLabel),
    ownerSide: draft.ownerSide || null,
    status: draft.status,
    availability: draft.availability || null,
    dueOn: text(draft.dueOn),
    dueIsProposal: draft.dueIsProposal,
    dueLabel: text(draft.dueLabel),
    forLabel: text(draft.forLabel),
  };
}

export type NeedPayload = ReturnType<typeof fieldsOf>;

/** Il titolo manca: l'errore del campo, prima di chiamare il servizio. */
export function needDraftErrors(draft: NeedDraft): Record<string, string> {
  return draft.title.trim() ? {} : { title: NEED_ERRORS.title };
}

/** Il corpo di «Aggiungi»: tutti i campi. */
export function needCreatePayload(draft: NeedDraft): NeedPayload {
  return fieldsOf(draft);
}

/** Il corpo di «Salva»: solo i campi cambiati rispetto all'esigenza letta; vuoto se non cambia niente. */
export function needPatchPayload(base: NeedView, draft: NeedDraft): Partial<NeedPayload> {
  const before = fieldsOf(draftFromNeed(base));
  const after = fieldsOf(draft);
  const out: Partial<NeedPayload> = {};
  for (const key of Object.keys(after) as Array<keyof NeedPayload>) {
    if (before[key] !== after[key]) (out as Record<string, unknown>)[key] = after[key];
  }
  return out;
}

/** Gli errori del servizio per campo, con i nomi dei campi della bozza (gli altri sotto `form`). */
export function needErrorsFromService(fieldErrors: Record<string, string> | undefined): Record<string, string> {
  if (!fieldErrors) return {};
  const fields = new Set<string>(Object.keys(emptyNeedDraft()));
  const out: Record<string, string> = {};
  for (const [key, message] of Object.entries(fieldErrors)) {
    const field = fields.has(key) ? key : key === "archiveReason" ? key : "form";
    out[field] ??= message;
  }
  return out;
}

/** Le scelte chiuse del modulo, nell'ordine dei vocabolari. */
export const NEED_FORM_CHOICES = Object.freeze({
  kinds: NEED_KINDS,
  ownerSides: NEED_OWNER_SIDES,
  availabilities: NEED_AVAILABILITIES,
});
