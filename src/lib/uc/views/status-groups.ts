/**
 * Stati delle domande in 4 gruppi (DESIGN §2.6, «Stati delle domande»).
 *
 * - Lateral Space vede «Da fare · Da verificare · Bloccate · A posto» e, in
 *   grigio, il sotto-stato (gli 8 stati di dettaglio restano nei filtri).
 * - Il cliente e il referente vedono «Da rispondere · In verifica · In attesa ·
 *   A posto», mai i sotto-stati.
 * - Lo stesso modello vale per i segmenti di Domande, la Panoramica e il cliente.
 *
 * Modulo puro e senza dipendenze di Node: si usa anche nei componenti client.
 */
import { STATUS_COLOR } from "../semaforo.ts";
import { ITEM_STATUSES, LS_CASE_ROLES, type CaseRole, type ItemStatus, type SemaforoColor } from "../vocab.ts";
import { formatCountIt } from "./format.ts";

/** Chi guarda: Lateral Space oppure il cliente (anche il referente dal link). */
export type Audience = "ls" | "cliente";

/** I 4 gruppi, nell'ordine dei segmenti e dei conteggi. */
export const STATUS_GROUPS = ["da_fare", "da_verificare", "bloccate", "a_posto"] as const;
export type StatusGroup = (typeof STATUS_GROUPS)[number];

/** Valore di `?vista=` in Domande per ogni gruppo. */
export const STATUS_GROUP_SLUG: Readonly<Record<StatusGroup, string>> = {
  da_fare: "da-fare",
  da_verificare: "da-verificare",
  bloccate: "bloccate",
  a_posto: "a-posto",
};

export const STATUS_GROUP_LABEL: Readonly<Record<Audience, Readonly<Record<StatusGroup, string>>>> = {
  ls: { da_fare: "Da fare", da_verificare: "Da verificare", bloccate: "Bloccate", a_posto: "A posto" },
  cliente: { da_fare: "Da rispondere", da_verificare: "In verifica", bloccate: "In attesa", a_posto: "A posto" },
};

export const STATUS_GROUP_OF: Readonly<Record<ItemStatus, StatusGroup>> = {
  da_chiedere: "da_fare",
  chiesta: "da_fare",
  mancante: "da_fare",
  parziale: "da_fare",
  in_verifica: "da_verificare",
  validata: "a_posto",
  non_applicabile: "a_posto",
  bloccata: "bloccate",
};

/** Sotto-etichetta grigia per Lateral Space; null dove il gruppo basta. */
const LS_SUBLABEL: Readonly<Record<ItemStatus, string | null>> = {
  da_chiedere: "Non ancora chiesta",
  chiesta: "Chiesta, in attesa",
  mancante: "Manca il dato",
  parziale: "Risposta parziale",
  in_verifica: null,
  validata: null,
  non_applicabile: "Non si applica",
  bloccata: null,
};

/** Etichetta del cliente e del referente: più precisa del gruppo dove serve. */
const CLIENT_LABEL: Readonly<Record<ItemStatus, string>> = {
  da_chiedere: "Da rispondere",
  chiesta: "Da rispondere",
  mancante: "Da rispondere",
  parziale: "Da completare",
  in_verifica: "In verifica",
  validata: "A posto",
  non_applicabile: "Non si applica",
  bloccata: "In attesa",
};

export interface StatusView {
  label: string;
  /** Lateral Space: il sotto-stato in grigio. Cliente: solo «Ci manca ancora questo dato.» per `mancante`. */
  sublabel: string | null;
  /** Colore del puntino: il testo resta `text-foreground`. `lucchetto` per le bloccate. */
  tone: SemaforoColor;
  group: StatusGroup;
}

/** Come si mostra lo stato di una domanda a chi guarda. */
export function statusView(status: ItemStatus, audience: Audience): StatusView {
  const group = STATUS_GROUP_OF[status];
  const tone = STATUS_COLOR[status];
  if (audience === "ls") return { label: STATUS_GROUP_LABEL.ls[group], sublabel: LS_SUBLABEL[status], tone, group };
  return { label: CLIENT_LABEL[status], sublabel: status === "mancante" ? "Ci manca ancora questo dato." : null, tone, group };
}

export interface GroupCount {
  group: StatusGroup;
  slug: string;
  label: string;
  count: number;
}

/**
 * Conteggi per gruppo nell'ordine dei segmenti. Accetta un elenco di stati
 * oppure i conteggi per stato (`readiness.per_stato`). Con `hideZero` i gruppi
 * a zero spariscono (lo zero non si mostra, DESIGN §1).
 */
export function groupCounts(
  input: readonly ItemStatus[] | Readonly<Partial<Record<ItemStatus, number>>>,
  audience: Audience,
  opts: { hideZero?: boolean } = {},
): GroupCount[] {
  const totals: Record<StatusGroup, number> = { da_fare: 0, da_verificare: 0, bloccate: 0, a_posto: 0 };
  if (Array.isArray(input)) {
    for (const s of input as readonly ItemStatus[]) totals[STATUS_GROUP_OF[s]] += 1;
  } else {
    const counts = input as Readonly<Partial<Record<ItemStatus, number>>>;
    for (const s of ITEM_STATUSES) {
      const n = counts[s];
      if (typeof n === "number" && Number.isFinite(n) && n > 0) totals[STATUS_GROUP_OF[s]] += Math.round(n);
    }
  }
  return STATUS_GROUPS.map((group) => ({ group, slug: STATUS_GROUP_SLUG[group], label: STATUS_GROUP_LABEL[audience][group], count: totals[group] })).filter(
    (g) => !opts.hideZero || g.count > 0,
  );
}

/**
 * Il gruppo dopo un numero, al singolare e al plurale. Le etichette dei gruppi
 * («Bloccate») e degli stati di dettaglio («Non ancora chiesta») non vanno
 * dopo un numero: «1 bloccate», «7 non ancora chiesta».
 */
const GROUP_COUNT_WORDS: Readonly<Record<Audience, Readonly<Record<StatusGroup, { one: string; many: string }>>>> = {
  ls: {
    da_fare: { one: "da fare", many: "da fare" },
    da_verificare: { one: "da verificare", many: "da verificare" },
    bloccate: { one: "bloccata", many: "bloccate" },
    a_posto: { one: "a posto", many: "a posto" },
  },
  cliente: {
    da_fare: { one: "da rispondere", many: "da rispondere" },
    da_verificare: { one: "in verifica", many: "in verifica" },
    bloccate: { one: "in attesa", many: "in attesa" },
    a_posto: { one: "a posto", many: "a posto" },
  },
};

/** «140 da fare», «1 bloccata», «10 bloccate»; per il cliente «40 in verifica», «5 in attesa». */
export function groupCountText(group: StatusGroup, count: number, audience: Audience): string {
  const words = GROUP_COUNT_WORDS[audience][group];
  return `${formatCountIt(count)} ${count === 1 ? words.one : words.many}`;
}

/** Gruppo dal valore di `?vista=`, oppure null. */
export function groupFromSlug(slug: string | null | undefined): StatusGroup | null {
  return STATUS_GROUPS.find((g) => STATUS_GROUP_SLUG[g] === slug) ?? null;
}

/** Ha almeno un ruolo di Lateral Space? Decide il pubblico di testi e `TechDetails`. */
export function isLsViewer(roles: readonly CaseRole[]): boolean {
  return roles.some((r) => (LS_CASE_ROLES as readonly CaseRole[]).includes(r));
}

/** Il pubblico di chi guarda, dai suoi ruoli nel caso. */
export function audienceFor(roles: readonly CaseRole[]): Audience {
  return isLsViewer(roles) ? "ls" : "cliente";
}
