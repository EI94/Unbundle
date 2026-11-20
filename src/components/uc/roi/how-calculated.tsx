import { Fold } from "@/components/ui-10/fold";
import { TextAction } from "@/components/ui-10/row";
import { VALUE_TEXT, type HowView } from "@/lib/uc/views/roi";
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
 * «Come si calcola» (rilascio 10, §3.5; DESIGN §3.8), una piega chiusa (`Fold`, H2 vero, aperta da `#come-si-calcola`):
 * in testa «Tutti i KPI (N) ›», che apre il pannello dei KPI (`?apri=kpi`); poi il costo all'anno e il valore nel
 * tempo, ipotesi e metodo, la formula del pareggio e l'esempio illustrativo. Tutto quello che non è una delle tre cifre.
 */
export function HowCalculated({ how, kpiHref = null, kpiTotal = 0 }: { how: HowView; kpiHref?: string | null; kpiTotal?: number }) {
  return (
    <Fold id="come-si-calcola" title={VALUE_TEXT.howCalculated}>
      {kpiHref && kpiTotal > 0 && <TextAction href={kpiHref}>{VALUE_TEXT.allKpis(kpiTotal)}</TextAction>}
      <div className="space-y-2">
        <dl className="grid gap-3 sm:grid-cols-2 sm:gap-6">
          {how.figures.map((f) => (
            <Figure key={f.label} figure={f} />
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
    </Fold>
  );
}
