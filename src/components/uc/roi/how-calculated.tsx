import { ChevronRight } from "lucide-react";
import type { HowView } from "@/lib/uc/views/roi";
import { Figure } from "./value-account";

function Part({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0 space-y-1.5">
      <h3 className="text-sm font-medium">{title}</h3>
      {children}
    </section>
  );
}

/**
 * «Come si calcola» (DESIGN §3.8), chiuso di partenza: esercizio all'anno e
 * valore nel tempo, ipotesi e metodo, la formula del pareggio e l'esempio
 * illustrativo. Tutto quello che non è uno dei tre numeri principali.
 */
export function HowCalculated({ how }: { how: HowView }) {
  return (
    <details className="group min-w-0 rounded-xl ring-1 ring-foreground/10">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 py-3 select-none [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden />
        <span className="font-medium">Come si calcola</span>
        <span className="hidden min-w-0 truncate text-sm text-muted-foreground sm:inline">ipotesi e metodo, pareggio e valore nel tempo, esempio illustrativo</span>
      </summary>
      <div className="space-y-6 border-t px-4 py-4">
        <div className="space-y-2">
          <dl className="grid gap-3 sm:grid-cols-2 sm:gap-6">
            {how.figures.map((f) => (
              <Figure key={f.label} figure={f} size="md" />
            ))}
          </dl>
          {how.note && <p className="text-sm text-muted-foreground">{how.note}</p>}
        </div>
        {(how.method.length > 0 || how.assumptions.length > 0) && (
          <Part title="Ipotesi e metodo">
            {how.method.map((m) => (
              <p key={m} className="text-sm break-words whitespace-pre-line">
                {m}
              </p>
            ))}
            {how.assumptions.length > 0 && (
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {how.assumptions.map((a) => (
                  <li key={a} className="break-words">
                    {a}
                  </li>
                ))}
              </ul>
            )}
          </Part>
        )}
        {how.formula.length > 0 && (
          <Part title="Pareggio e valore nel tempo">
            {how.formula.map((f) => (
              <p key={f} className="text-sm break-words whitespace-pre-line">
                {f}
              </p>
            ))}
          </Part>
        )}
        {(how.example.note || how.example.rows.length > 0) && (
          <Part title="Esempio illustrativo">
            {how.example.note && <p className="text-sm break-words text-muted-foreground">{how.example.note}</p>}
            {how.example.rows.length > 0 && (
              <dl className="divide-y text-sm">
                {how.example.rows.map((r, i) => (
                  <div key={`${r.label}-${i}`} className="flex min-w-0 justify-between gap-4 py-1.5">
                    <dt className="min-w-0 break-words text-muted-foreground">{r.label}</dt>
                    <dd className="shrink-0 font-medium tabular-nums">{r.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </Part>
        )}
      </div>
    </details>
  );
}
