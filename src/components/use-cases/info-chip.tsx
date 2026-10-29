import { ClipboardList } from "lucide-react";
import { SEMAFORO_TONE } from "@/components/uc/common/semaforo-tone";
import { INFO_PROGRESS_PARAM, INFO_PROGRESS_STATES, INFO_PROGRESS_TEXT, type InfoProgressState, type InfoProgressView } from "@/lib/use-cases/info-progress";
import { cn } from "@/lib/utils";

/**
 * «Raccolta informazioni» (SPEC §P2.8, §P2.10.3–5): lo stato calcolato di una scheda, solo per i
 * revisori. Non è una fase e non deve sembrarlo: niente pillola, niente bordo, niente puntino, solo
 * un'icona colorata con il tono e la parola in grigio. La fase resta una decisione delle persone.
 *
 * - `long`: nella testata della scheda, accanto alla pillola della fase: «Informazioni: in attesa»
 *   (solo lo stato; conteggi e che cosa resta in «Cosa serve»).
 * - `short`: nelle righe di «Da decidere» e nelle card della Panoramica («Info: da verificare»), solo per
 *   gli stati che chiedono a qualcuno di fare qualcosa (`showInRows`). Gli altri stanno nella scheda e
 *   nel filtro, non in ogni riga.
 */
export interface InfoChipProps {
  text: string;
  ariaLabel: string;
  /** Il colore dell'icona. */
  iconClass: string;
  className: string;
  state: InfoProgressState;
}

const CHIP_CLASS = "inline-flex max-w-full min-w-0 items-center gap-1 align-middle text-xs text-muted-foreground";

/** Che cosa mostra il chip; null quando non c'è niente da mostrare. Puro, lo prova `info-chip.test.ts`. */
export function infoChipProps(view: InfoProgressView | null | undefined, variant: "long" | "short"): InfoChipProps | null {
  if (!view) return null;
  if (variant === "short" && !view.showInRows) return null;
  return {
    text: variant === "long" ? view.label : view.chip,
    ariaLabel: view.ariaLabel,
    iconClass: SEMAFORO_TONE[view.tone].text,
    className: CHIP_CLASS,
    state: view.state,
  };
}

export function InfoChip({ view, variant, className }: { view: InfoProgressView | null | undefined; variant: "long" | "short"; className?: string }) {
  const props = infoChipProps(view, variant);
  if (!props) return null;
  return (
    <span data-slot="info-chip" data-state={props.state} role="img" aria-label={props.ariaLabel} title={variant === "short" ? props.ariaLabel : undefined} className={cn(props.className, className)}>
      <ClipboardList aria-hidden className={cn("size-3.5 shrink-0", props.iconClass)} />
      <span aria-hidden className="truncate">
        {props.text}
      </span>
    </span>
  );
}

export interface InfoFilterOption {
  value: string;
  label: string;
}

/**
 * Le voci del filtro «Informazioni» della pagina: gli stati che hanno almeno una scheda, nell'ordine
 * di `INFO_PROGRESS_STATES`, più quello scelto nell'indirizzo anche se nessuna scheda lo ha più.
 * Vuoto: il campo non si mostra. Mai per persona: è lo stato delle schede.
 */
export function infoFilterOptions(info: Readonly<Record<string, InfoProgressView>> | null | undefined, selected: InfoProgressState | null): InfoFilterOption[] {
  if (!info) return [];
  const present = new Map<InfoProgressState, InfoProgressView>();
  for (const view of Object.values(info)) if (!present.has(view.state)) present.set(view.state, view);
  return INFO_PROGRESS_STATES.filter((state) => present.has(state) || state === selected).map((state) => ({
    value: INFO_PROGRESS_PARAM[state],
    label: present.get(state)?.option ?? INFO_PROGRESS_TEXT.states[state].option,
  }));
}
