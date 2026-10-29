import type { AgentTone } from "@/lib/use-cases/agents";
import { cn } from "@/lib/utils";

/**
 * Il tag dell'agente (rilascio «Panoramica»): «LIBRA L1», il prefisso del titolo nel colore
 * dell'agente (`--uc-agente-*` di globals.css, solo tema scuro). Il colore sta solo sul tag e sulla
 * barra del valore; il resto della pagina resta neutro. Un agente senza tono (fuori dalla tavolozza
 * della pagina) ha il tag neutro: bordo dei campi e testo pieno. Angoli arrotondati, mai una
 * pillola: non deve sembrare una fase. Le classi sono scritte per intero, così Tailwind le trova.
 */
export const AGENT_TAG_CLASS: Readonly<Record<AgentTone, string>> = {
  1: "border-uc-agente-1/55 bg-uc-agente-1/16 text-uc-agente-1",
  2: "border-uc-agente-2/55 bg-uc-agente-2/16 text-uc-agente-2",
  3: "border-uc-agente-3/55 bg-uc-agente-3/16 text-uc-agente-3",
  4: "border-uc-agente-4/55 bg-uc-agente-4/16 text-uc-agente-4",
  5: "border-uc-agente-5/55 bg-uc-agente-5/16 text-uc-agente-5",
  6: "border-uc-agente-6/55 bg-uc-agente-6/16 text-uc-agente-6",
  7: "border-uc-agente-7/55 bg-uc-agente-7/16 text-uc-agente-7",
  8: "border-uc-agente-8/55 bg-uc-agente-8/16 text-uc-agente-8",
  9: "border-uc-agente-9/55 bg-uc-agente-9/16 text-uc-agente-9",
  10: "border-uc-agente-10/55 bg-uc-agente-10/16 text-uc-agente-10",
};

/** Il nome dell'agente scritto nel suo colore (i gruppi «Per agente»). */
export const AGENT_TEXT_CLASS: Readonly<Record<AgentTone, string>> = {
  1: "text-uc-agente-1",
  2: "text-uc-agente-2",
  3: "text-uc-agente-3",
  4: "text-uc-agente-4",
  5: "text-uc-agente-5",
  6: "text-uc-agente-6",
  7: "text-uc-agente-7",
  8: "text-uc-agente-8",
  9: "text-uc-agente-9",
  10: "text-uc-agente-10",
};

/** La barra del valore: piena per gli euro contati, tratteggiata per quelli da misurare. */
export const AGENT_BAR_CLASS: Readonly<Record<AgentTone, { fill: string; dashed: string }>> = {
  1: { fill: "bg-uc-agente-1", dashed: "border-uc-agente-1" },
  2: { fill: "bg-uc-agente-2", dashed: "border-uc-agente-2" },
  3: { fill: "bg-uc-agente-3", dashed: "border-uc-agente-3" },
  4: { fill: "bg-uc-agente-4", dashed: "border-uc-agente-4" },
  5: { fill: "bg-uc-agente-5", dashed: "border-uc-agente-5" },
  6: { fill: "bg-uc-agente-6", dashed: "border-uc-agente-6" },
  7: { fill: "bg-uc-agente-7", dashed: "border-uc-agente-7" },
  8: { fill: "bg-uc-agente-8", dashed: "border-uc-agente-8" },
  9: { fill: "bg-uc-agente-9", dashed: "border-uc-agente-9" },
  10: { fill: "bg-uc-agente-10", dashed: "border-uc-agente-10" },
};

/** Senza tono: il bordo dei campi (3,4:1 nell'area) e il testo pieno, senza fondo. */
export const NEUTRAL_TAG_CLASS = "border-input text-foreground";
export const NEUTRAL_TEXT_CLASS = "text-foreground";
/** La barra degli use case senza agente: il grigio dei testi secondari. */
export const NEUTRAL_BAR_CLASS = { fill: "bg-muted-foreground", dashed: "border-muted-foreground" } as const;

/**
 * Il tag: `label` è «LIBRA L1». `decorative`: il tag ripete il prefisso che il titolo dice già ai
 * lettori di schermo, e lo nascondono.
 */
export function AgentTag({ label, tone, decorative = false, className }: { label: string; tone: AgentTone | null; decorative?: boolean; className?: string }) {
  return (
    <span
      data-slot="agent-tag"
      data-tone={tone ?? "neutro"}
      aria-hidden={decorative || undefined}
      className={cn(
        "inline-flex max-w-full min-w-0 items-center rounded-md border px-1.5 py-px text-xs font-medium whitespace-nowrap",
        tone ? AGENT_TAG_CLASS[tone] : NEUTRAL_TAG_CLASS,
        className,
      )}
    >
      <span className="truncate">{label}</span>
    </span>
  );
}
