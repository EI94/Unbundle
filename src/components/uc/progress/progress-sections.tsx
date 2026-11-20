import { Check, ChevronRight } from "lucide-react";
import { formatCountIt } from "@/lib/uc/views/format";
import type { PhaseGroup } from "@/lib/uc/views/progress";
import { cn } from "@/lib/utils";

/**
 * Pezzi di «Via allo sviluppo» (DESIGN §3.5; rilascio 10, §3.5: la sezione
 * della Panoramica): lo storico e la diagnostica, nelle loro pieghe, e le fasi
 * con i loro stati per il pannello «Tutte le tappe». Componenti server di sola
 * presentazione: i testi arrivano già pronti da `views/progress.ts`.
 */

const FRAME = "divide-y overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10";

/**
 * Le 5 fasi della realizzazione con i loro stati e che cosa vogliono dire, la fase di adesso segnata (rilascio 10,
 * §3.5, F-030 e F-039: era «Come funziona» di `/via`, con la striscia delle fasi). Sta nel pannello «Tutte le tappe».
 */
export function CasePhases({ phases }: { phases: readonly PhaseGroup[] }) {
  return (
    <div className="space-y-2">
      <ol className="space-y-3">
        {phases.map((g, i) => (
          <li key={g.phase} aria-current={g.current ? "step" : undefined} className="min-w-0">
            <p className="flex items-center gap-2 text-sm">
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs tabular-nums",
                  g.done ? "border-uc-verde/60 text-uc-verde" : g.current ? "border-foreground font-medium" : "border-border text-muted-foreground",
                )}
                aria-hidden
              >
                {g.done ? <Check className="size-3.5" /> : i + 1}
              </span>
              <span className={cn(g.current ? "font-medium" : undefined)}>{g.label}</span>
              {g.current && <span className="text-xs text-muted-foreground">adesso</span>}
            </p>
            <ul className="mt-1 space-y-1 pl-8 text-sm">
              {g.steps.map((s) => (
                <li key={s.status} className="min-w-0">
                  <span className={cn(s.current || s.before ? "font-medium" : undefined)}>{s.label}</span>
                  {s.before && <span className="text-muted-foreground"> (prima della pausa)</span>}
                  <span className="text-muted-foreground">: {s.meaning}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
      <p className="text-sm text-muted-foreground">«In pausa» e «Chiuso» sono stati della realizzazione: in pausa riprende dallo stato in cui era.</p>
    </div>
  );
}

/** «Storico»: proposte e decisioni, poi le versioni del catalogo. Righe già scritte da `views/progress.ts`. */
export function ViaHistory({ reviews, versions }: { reviews: readonly { id: string; title: string; detail: string }[]; versions: readonly { key: string; title: string; detail: string }[] }) {
  return (
    <>
      {reviews.length > 0 && (
        <ul className={FRAME}>
          {reviews.map((r) => (
            <li key={r.id} className="min-w-0 px-4 py-3 text-sm">
              <p className="font-medium">{r.title}</p>
              {r.detail && <p className="mt-0.5 break-words text-muted-foreground">{r.detail}</p>}
            </li>
          ))}
        </ul>
      )}
      {versions.length > 0 && (
        <ul className={FRAME}>
          {versions.map((v) => (
            <li key={v.key} className="min-w-0 px-4 py-3 text-sm">
              <p className="font-medium">{v.title}</p>
              {v.detail && <p className="mt-0.5 break-words text-muted-foreground">{v.detail}</p>}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/**
 * «Diagnostica» (solo Lateral Space): copertura del modello dati, quali
 * domande contano, eccezioni usate e gli elementi non coperti da domande
 * (chiavi, che a Lateral Space servono).
 */
export function CoverageCard({ text, policy, exceptions, uncovered }: { text: string; policy: string; exceptions: string; uncovered: readonly { itemId: string; key: string }[] }) {
  return (
    <div className="space-y-3 text-sm">
      <dl className="space-y-2">
        <div>
          <dt className="text-muted-foreground">Copertura del modello dati</dt>
          <dd>{text}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Quali domande contano</dt>
          <dd>{policy}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Eccezioni</dt>
          <dd>{exceptions}</dd>
        </div>
      </dl>
      {uncovered.length > 0 && (
        <details className="group/unc min-w-0">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1 text-muted-foreground select-none hover:text-foreground sm:min-h-9 [&::-webkit-details-marker]:hidden">
            Elementi non coperti da domande ({formatCountIt(uncovered.length)})
            <ChevronRight className="size-3.5 transition-transform group-open/unc:rotate-90" aria-hidden />
          </summary>
          <ul className="mt-2 flex max-h-64 flex-wrap gap-1.5 overflow-y-auto">
            {uncovered.slice(0, 500).map((u) => (
              <li key={u.itemId} className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs break-all">
                {u.key}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
