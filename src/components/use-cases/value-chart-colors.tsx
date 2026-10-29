import type { GroupLegendEntry, GroupSlot } from "@/lib/use-cases/value-charts";
import { cn } from "@/lib/utils";

/**
 * I colori dei gruppi nei grafici di «Benefici e costi»: i token `--uc-serie-*` di globals.css
 * (tema scuro di base e chiaro), tre colori e il grigio di «Altro» (0); con gli agenti nei titoli i
 * toni degli agenti (`--uc-agente-*`, gli stessi dei tag della Panoramica). Le classi sono scritte
 * per intero, così Tailwind le trova.
 */
export const SLOT_FILL: Readonly<Record<GroupSlot, string>> = {
  0: "bg-uc-serie-altro",
  1: "bg-uc-serie-1",
  2: "bg-uc-serie-2",
  3: "bg-uc-serie-3",
  "agente-1": "bg-uc-agente-1",
  "agente-2": "bg-uc-agente-2",
  "agente-3": "bg-uc-agente-3",
  "agente-4": "bg-uc-agente-4",
  "agente-5": "bg-uc-agente-5",
  "agente-6": "bg-uc-agente-6",
  "agente-7": "bg-uc-agente-7",
  "agente-8": "bg-uc-agente-8",
  "agente-9": "bg-uc-agente-9",
  "agente-10": "bg-uc-agente-10",
};

/** Il riempimento delle bolle decise: il colore, velato. */
export const SLOT_FILL_MID: Readonly<Record<GroupSlot, string>> = {
  0: "bg-uc-serie-altro/50",
  1: "bg-uc-serie-1/50",
  2: "bg-uc-serie-2/50",
  3: "bg-uc-serie-3/50",
  "agente-1": "bg-uc-agente-1/50",
  "agente-2": "bg-uc-agente-2/50",
  "agente-3": "bg-uc-agente-3/50",
  "agente-4": "bg-uc-agente-4/50",
  "agente-5": "bg-uc-agente-5/50",
  "agente-6": "bg-uc-agente-6/50",
  "agente-7": "bg-uc-agente-7/50",
  "agente-8": "bg-uc-agente-8/50",
  "agente-9": "bg-uc-agente-9/50",
  "agente-10": "bg-uc-agente-10/50",
};

/** Il riempimento chiaro: «da decidere», e la parte «da misurare» delle barre. */
export const SLOT_FILL_SOFT: Readonly<Record<GroupSlot, string>> = {
  0: "bg-uc-serie-altro/15",
  1: "bg-uc-serie-1/15",
  2: "bg-uc-serie-2/15",
  3: "bg-uc-serie-3/15",
  "agente-1": "bg-uc-agente-1/15",
  "agente-2": "bg-uc-agente-2/15",
  "agente-3": "bg-uc-agente-3/15",
  "agente-4": "bg-uc-agente-4/15",
  "agente-5": "bg-uc-agente-5/15",
  "agente-6": "bg-uc-agente-6/15",
  "agente-7": "bg-uc-agente-7/15",
  "agente-8": "bg-uc-agente-8/15",
  "agente-9": "bg-uc-agente-9/15",
  "agente-10": "bg-uc-agente-10/15",
};

export const SLOT_BORDER: Readonly<Record<GroupSlot, string>> = {
  0: "border-uc-serie-altro",
  1: "border-uc-serie-1",
  2: "border-uc-serie-2",
  3: "border-uc-serie-3",
  "agente-1": "border-uc-agente-1",
  "agente-2": "border-uc-agente-2",
  "agente-3": "border-uc-agente-3",
  "agente-4": "border-uc-agente-4",
  "agente-5": "border-uc-agente-5",
  "agente-6": "border-uc-agente-6",
  "agente-7": "border-uc-agente-7",
  "agente-8": "border-uc-agente-8",
  "agente-9": "border-uc-agente-9",
  "agente-10": "border-uc-agente-10",
};

/** La legenda dei gruppi: un pallino del colore e il nome, mai il colore da solo. */
export function GroupLegendItems({ entries, square = false }: { entries: readonly GroupLegendEntry[]; square?: boolean }) {
  return (
    <>
      {entries.map((entry) => (
        <span key={`${entry.slot}-${entry.label}`} className="inline-flex items-center gap-1.5">
          <span aria-hidden className={cn("size-2.5 shrink-0", square ? "rounded-[2px]" : "rounded-full", SLOT_FILL[entry.slot])} />
          {entry.label}
        </span>
      ))}
    </>
  );
}
