/**
 * Da dove viene un fatto, a parole (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md §7.2): «Call 14 nov»,
 * «Documento 14 nov», «Scritto a mano», «senza fonte». Le date nelle righe hanno la forma del resto di Unbundle
 * («14 nov», con l'anno se è un altro: `formatDayInYear`). Modulo puro.
 */
import { formatDayInYear } from "../use-cases/format.ts";
import { CONTEXT_TEXT } from "./text.ts";
import type { FactOrigin, SourceKind } from "./vocab.ts";

export type SourceLabelKind = "call" | "documento" | "manuale" | "senza_fonte";

export interface FactSourceLabel {
  kind: SourceLabelKind;
  /** Con la data: «Call 14 nov», «Documento 14 nov», «Scritto a mano», «senza fonte». */
  label: string;
  /** Senza la data: «Call», «Documento», «Scritto a mano», «senza fonte». */
  word: string;
  /** «14 nov», o null se la fonte non ha una data (scritto a mano, senza fonte). */
  day: string | null;
}

/**
 * La fonte di un fatto, di un impegno o di una domanda. `origin = 'fonte'` senza la fonte vuol dire «senza fonte»
 * (l'appunto è stato tolto); `origin = 'manuale'` vuol dire «Scritto a mano».
 */
export function factSourceLabel(
  fact: { origin: FactOrigin | "chiedi"; sourceKind: SourceKind | null; sourceOccurredOn: string | null },
  today: Date | string = new Date(),
): FactSourceLabel {
  const T = CONTEXT_TEXT.fact;
  if (fact.origin !== "fonte") return { kind: "manuale", label: T.sourceManual, word: T.sourceManual, day: null };
  if (fact.sourceKind === null) return { kind: "senza_fonte", label: T.noSource, word: T.noSource, day: null };
  const day = formatDayInYear(fact.sourceOccurredOn, today);
  if (fact.sourceKind === "documento") return { kind: "documento", label: day ? T.sourceDocument(day) : T.sourceDocumentWord, word: T.sourceDocumentWord, day };
  return { kind: "call", label: day ? T.sourceCall(day) : T.sourceCallWord, word: T.sourceCallWord, day };
}

/** Un giorno nelle righe: «14 nov», con l'anno se è un altro. Una data che non c'è dà una stringa vuota. */
export function dayLabel(value: Date | string | null | undefined, today: Date | string = new Date()): string {
  return formatDayInYear(value, today) ?? "";
}
