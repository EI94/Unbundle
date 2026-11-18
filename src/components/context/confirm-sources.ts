/**
 * (9b) Le fonti nate dal lavoro in «Da confermare» (docs/contesto/RILASCIO-9b-COSTRUZIONE.md §2.5, §2.11): con una fonte
 * sola sulla pagina la testata dice da dove vengono le proposte («Dalle risposte del referente per XX-0012, 14 nov»,
 * «Da chi costruisce XX-0012, 18 nov»), e la fonte di «Ora: …» in un conflitto non le scambia per una call («Referente
 * 14 nov», «Costruzione 18 nov»). Gli appunti e i documenti restano come in `view-model.ts`.
 *
 * Il codice dello use case sta nel titolo della fonte, che scrive Unbundle (`notes.answersTitle`, `notes.learnedTitle`).
 * Modulo puro: import relativi `.ts`, lo usa il componente del browser.
 */
import { dayLabel, factSourceLabel } from "../../lib/context/labels.ts";
import { CONTEXT_TEXT } from "../../lib/context/text.ts";
import { LEARNED_SOURCE_PREFIX } from "../../lib/context/vocab.ts";
import type { OpenProposals, ProposalView } from "../../lib/db/queries/context-proposals.ts";

const T = CONTEXT_TEXT;

type ConfirmSource = OpenProposals["sources"][number];

/** Il codice nel titolo di una fonte scritto da Unbundle («Risposte del referente · XX-0012» → «XX-0012»); se il titolo è un altro, il titolo. */
function codeIn(title: string, template: (code: string) => string): string {
  const prefix = template("");
  return title.startsWith(prefix) && title.length > prefix.length ? title.slice(prefix.length).trim() : title;
}

/** Una fonte nata dal lavoro: le risposte di un referente o una cosa imparata costruendo un caso. */
function workKind(source: Pick<ConfirmSource, "kind" | "learned">): "risposte" | "costruzione" | null {
  if (source.kind === "risposta") return "risposte";
  return source.learned === true ? "costruzione" : null;
}

/**
 * La testata di «Da confermare» per una fonte sola nata dal lavoro: «Dalle risposte del referente per XX-0012, 14 nov» o
 * «Da chi costruisce XX-0012, 18 nov». null per gli appunti e i documenti (la testata di sempre).
 */
export function workSourceHeading(source: Pick<ConfirmSource, "kind" | "learned" | "title" | "occurredOn">, today: string): string | null {
  const kind = workKind(source);
  if (!kind) return null;
  const day = dayLabel(source.occurredOn, today);
  return kind === "risposte" ? T.confirm.fromAnswers(codeIn(source.title, T.notes.answersTitle), day) : T.confirm.fromBuilding(codeIn(source.title, T.notes.learnedTitle), day);
}

/** La testata della pagina: quella di una fonte nata dal lavoro, se è l'unica; altrimenti `fallback` (`confirmSubtitle`). */
export function confirmHeading(sources: readonly ConfirmSource[], today: string, fallback: string | null): string | null {
  return (sources.length === 1 ? workSourceHeading(sources[0], today) : null) ?? fallback;
}

/**
 * La fonte di una proposta per «Ora: … (Referente 14 nov)», se è nata dal lavoro; null per gli appunti e i documenti
 * (`proposalSource`).
 */
export function workSourceLabel(proposal: Pick<ProposalView, "sourceId">, sources: readonly ConfirmSource[], today: string): string | null {
  const source = sources.find((item) => item.id === proposal.sourceId);
  if (!source || !workKind(source)) return null;
  return factSourceLabel(
    { origin: "fonte", sourceKind: source.kind, sourceOccurredOn: source.occurredOn, sourceOrigin: source.origin, sourceExternalId: source.learned === true ? LEARNED_SOURCE_PREFIX : null },
    today,
  ).label;
}
