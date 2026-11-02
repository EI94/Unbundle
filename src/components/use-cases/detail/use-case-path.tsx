import { Check } from "lucide-react";
import type { AgentTone } from "@/lib/use-cases/agents";
import { GUIDED_TEXT, type UseCasePathView } from "@/lib/use-cases/guided";
import { cn } from "@/lib/utils";

/**
 * Il colore del percorso, quello dell'agente del titolo: le classi scritte per intero, così
 * Tailwind le trova. Senza agente il percorso usa il colore del testo.
 */
export const PATH_TONE_CLASS: Readonly<Record<AgentTone, string>> = {
  1: "[--path-c:var(--uc-agente-1)]",
  2: "[--path-c:var(--uc-agente-2)]",
  3: "[--path-c:var(--uc-agente-3)]",
  4: "[--path-c:var(--uc-agente-4)]",
  5: "[--path-c:var(--uc-agente-5)]",
  6: "[--path-c:var(--uc-agente-6)]",
  7: "[--path-c:var(--uc-agente-7)]",
  8: "[--path-c:var(--uc-agente-8)]",
  9: "[--path-c:var(--uc-agente-9)]",
  10: "[--path-c:var(--uc-agente-10)]",
};

const BULLET = {
  fatto: "bg-[var(--path-c)] text-background",
  adesso: "border-2 border-[var(--path-c)] bg-background text-foreground ring-3 ring-[color-mix(in_oklab,var(--path-c)_50%,transparent)]",
  dopo: "border border-input bg-background text-muted-foreground",
} as const;

/**
 * Il percorso dello use case (rilascio 3, `pathOfUseCase`): da Proposto a In uso, o a Diffusa per
 * una best practice, in tre colonne sul telefono e in una riga da 40rem della scheda. Lo stato di
 * ogni passo lo dicono il bordo del pallino, il peso dell'etichetta e il testo nascosto « (fatto)»
 * o « (adesso)», mai il solo colore; il passo corrente ha `aria-current="step"`. I passi non sono
 * link. Reso sul server. `data-tone` dice al tema «Chiaro» se il percorso ha il colore di un
 * agente: lì l'alone del passo «adesso» sale al 70% (vedi in fondo a globals.css).
 */
export function UseCasePath({ path, tone = null, className }: { path: UseCasePathView; tone?: AgentTone | null; className?: string }) {
  const t = GUIDED_TEXT.path;
  const spread = path.kind === "da_diffondere";
  // Nella forma stretta il primo passo della seconda riga non ha la linea che lo lega al precedente.
  const rowStart = spread ? 2 : 3;
  return (
    <ol
      aria-label={t.ariaLabel}
      data-slot="use-case-path"
      data-tone={tone ?? "neutro"}
      className={cn(
        "grid gap-y-3 [--path-c:var(--foreground)]",
        spread ? "grid-cols-2 @min-[40rem]/scheda:grid-cols-4" : "grid-cols-3 @min-[40rem]/scheda:grid-cols-6",
        tone ? PATH_TONE_CLASS[tone] : null,
        className,
      )}
    >
      {path.steps.map((step, index) => (
        <li
          key={step.key}
          data-step={step.key}
          data-state={step.state}
          aria-current={step.current ? "step" : undefined}
          className={cn(
            "relative flex min-w-0 flex-col items-center gap-1 px-1 text-center",
            index > 0 &&
              "before:absolute before:top-3 before:right-[calc(50%+1rem)] before:left-[calc(-50%+1rem)] before:h-px before:content-['']",
            index > 0 && (step.state === "dopo" ? "before:bg-input" : "before:bg-[var(--path-c)]"),
            index === rowStart && "before:hidden @min-[40rem]/scheda:before:block",
          )}
        >
          <span aria-hidden className={cn("flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium tabular-nums", BULLET[step.state])}>
            {step.state === "fatto" ? <Check className="size-3.5" strokeWidth={3} /> : step.number}
          </span>
          <span className={cn("text-sm break-words", step.state === "adesso" ? "font-medium text-foreground" : step.state === "fatto" ? "text-foreground" : "text-muted-foreground")}>
            {step.label}
            {step.state === "fatto" ? <span className="sr-only">{t.srDone}</span> : step.state === "adesso" ? <span className="sr-only">{t.srNow}</span> : null}
          </span>
          {step.sub ? <span className="text-xs break-words text-muted-foreground">{step.sub}</span> : null}
        </li>
      ))}
    </ol>
  );
}
