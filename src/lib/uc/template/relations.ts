/**
 * Relazioni ammesse tra le voci di un template (PIANO §4.1, regola 3).
 *
 * Ogni collegamento è una tripla (tipo di origine, relazione, tipo di
 * destinazione). Una relazione fuori da `LINK_RELATIONS` o una coppia non
 * ammessa ferma il caricamento.
 *
 * Modulo puro.
 */
import { ITEM_KINDS, LINK_RELATIONS, type ItemKind, type LinkRelation } from "../vocab.ts";

const ALL_BUT_QUESTION: readonly ItemKind[] = ITEM_KINDS.filter((k) => k !== "domanda");

interface RelationRule {
  readonly from: readonly ItemKind[];
  readonly to: readonly ItemKind[];
  /** `sostituisce`: la destinazione deve avere lo stesso tipo dell'origine. */
  readonly sameKind?: boolean;
}

/** Tabella delle relazioni: da quali tipi a quali tipi. */
export const RELATION_RULES: Readonly<Record<LinkRelation, RelationRule>> = {
  usa: {
    from: ["kpi", "formula", "entita", "regola"],
    to: ["campo", "parametro", "kpi", "decisione", "entita"],
  },
  alimentato_da: {
    from: ["campo", "kpi", "entita"],
    to: ["fonte", "entita"],
  },
  precisa: {
    from: ["domanda"],
    to: ALL_BUT_QUESTION,
  },
  dipende_da: {
    from: ["vincolo_rigido", "parametro", "incertezza", "decisione", "vincolo_morbido", "uscita", "obiettivo"],
    to: ["campo", "parametro", "formula", "decisione", "kpi", "uscita", "vincolo_rigido", "incertezza"],
  },
  vincola: {
    from: ["regola"],
    to: ALL_BUT_QUESTION,
  },
  controlla: {
    from: ["controllo_qualita"],
    to: ["campo", "entita", "fonte"],
  },
  deriva_da: {
    from: ALL_BUT_QUESTION,
    to: ALL_BUT_QUESTION,
  },
  sostituisce: {
    from: ITEM_KINDS,
    to: ITEM_KINDS,
    sameKind: true,
  },
};

export function isLinkRelation(value: unknown): value is LinkRelation {
  return typeof value === "string" && (LINK_RELATIONS as readonly string[]).includes(value);
}

/** Vero se la tripla (origine, relazione, destinazione) è ammessa. */
export function isRelationAllowed(fromKind: ItemKind, relation: LinkRelation, toKind: ItemKind): boolean {
  const rule = RELATION_RULES[relation];
  if (!rule) return false;
  if (!rule.from.includes(fromKind) || !rule.to.includes(toKind)) return false;
  return !rule.sameKind || fromKind === toKind;
}

/** Messaggio in italiano per una tripla non ammessa. */
export function relationMessage(fromKey: string, fromKind: ItemKind, relation: string, toKey: string, toKind: ItemKind): string {
  return `Collegamento non ammesso: «${fromKey}» (${fromKind}) -${relation}-> «${toKey}» (${toKind}).`;
}
