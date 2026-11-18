/**
 * Da dove viene un fatto, a parole (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md §7.2): «Call 14 nov»,
 * «Documento 14 nov», «Scritto a mano», «senza fonte». (9b, RILASCIO-9b-COSTRUZIONE.md §4.5) Anche «Referente 14 nov»
 * per le risposte di un referente e «Costruzione 14 nov» per una cosa imparata costruendo un caso: nessuno le scambia
 * per una call. Le date nelle righe hanno la forma del resto di Unbundle («14 nov», con l'anno se è un altro:
 * `formatDayInYear`). Modulo puro.
 */
import { formatDayInYear } from "../use-cases/format.ts";
import { CONTEXT_TEXT } from "./text.ts";
import { isLearnedSource } from "./visibility.ts";
import type { FactOrigin, SourceKind, SourceOrigin } from "./vocab.ts";

export type SourceLabelKind = "call" | "documento" | "referente" | "costruzione" | "manuale" | "senza_fonte";

export interface FactSourceLabel {
  kind: SourceLabelKind;
  /** Con la data: «Call 14 nov», «Documento 14 nov», «Referente 14 nov», «Costruzione 14 nov», «Scritto a mano», «senza fonte». */
  label: string;
  /** Senza la data: «Call», «Documento», «Referente», «Costruzione», «Scritto a mano», «senza fonte». */
  word: string;
  /** «14 nov», o null se la fonte non ha una data (scritto a mano, senza fonte). */
  day: string | null;
}

/**
 * La fonte di un fatto, di un impegno o di una domanda. `origin = 'fonte'` senza la fonte vuol dire «senza fonte»
 * (l'appunto è stato tolto); `origin = 'manuale'` vuol dire «Scritto a mano». `sourceOrigin` e `sourceExternalId`
 * (facoltativi) dicono se la fonte è una cosa imparata costruendo (`unbundle impara`).
 */
export function factSourceLabel(
  fact: { origin: FactOrigin | "chiedi"; sourceKind: SourceKind | null; sourceOccurredOn: string | null; sourceOrigin?: SourceOrigin | null; sourceExternalId?: string | null },
  today: Date | string = new Date(),
): FactSourceLabel {
  const T = CONTEXT_TEXT.fact;
  if (fact.origin !== "fonte") return { kind: "manuale", label: T.sourceManual, word: T.sourceManual, day: null };
  if (fact.sourceKind === null) return { kind: "senza_fonte", label: T.noSource, word: T.noSource, day: null };
  const day = formatDayInYear(fact.sourceOccurredOn, today);
  if (fact.sourceKind === "documento") return { kind: "documento", label: day ? T.sourceDocument(day) : T.sourceDocumentWord, word: T.sourceDocumentWord, day };
  if (fact.sourceKind === "risposta") return { kind: "referente", label: day ? T.sourceAnswer(day) : T.sourceAnswerWord, word: T.sourceAnswerWord, day };
  if (isLearnedSource({ origin: fact.sourceOrigin ?? null, externalId: fact.sourceExternalId })) {
    return { kind: "costruzione", label: day ? T.sourceLearned(day) : T.sourceLearnedWord, word: T.sourceLearnedWord, day };
  }
  return { kind: "call", label: day ? T.sourceCall(day) : T.sourceCallWord, word: T.sourceCallWord, day };
}

/** Un giorno nelle righe: «14 nov», con l'anno se è un altro. Una data che non c'è dà una stringa vuota. */
export function dayLabel(value: Date | string | null | undefined, today: Date | string = new Date()): string {
  return formatDayInYear(value, today) ?? "";
}
