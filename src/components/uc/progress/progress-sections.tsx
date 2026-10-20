import Link from "next/link";
import { Check, CheckCircle2, ChevronRight, Circle } from "lucide-react";
import { formatCountIt } from "@/lib/uc/views/format";
import type { PhaseGroup, ViaConditionView, ViaSignatureLine } from "@/lib/uc/views/progress";
import { cn } from "@/lib/utils";

/**
 * Sezioni di «Via allo sviluppo» (DESIGN §3.5): cosa serve ancora, firme,
 * come funziona, storico e diagnostica. Componenti server di sola
 * presentazione: i testi arrivano già pronti da `views/progress.ts`.
 */

const FRAME = "divide-y overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10";
const DISCLOSURE =
  "flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-base font-semibold select-none [&::-webkit-details-marker]:hidden";

/** Una sezione che si apre: «Come funziona», «Storico», «Diagnostica». Chiusa di partenza. */
export function Disclosure({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <details id={id} className="group min-w-0 scroll-mt-40">
      <summary className={DISCLOSURE}>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden />
        {title}
      </summary>
      <div className="mt-3 space-y-4 pl-0 sm:pl-6">{children}</div>
    </details>
  );
}

function ConditionRow({ c, href }: { c: ViaConditionView; href: string | null }) {
  const body = (
    <>
      {c.ok ? <CheckCircle2 className="size-4 shrink-0 text-uc-verde" aria-label="A posto" /> : <Circle className="size-4 shrink-0 text-muted-foreground" aria-label="Da fare" />}
      <span className="min-w-0 flex-1 text-sm">
        {c.label}
        {c.detail && <span className="text-muted-foreground tabular-nums"> · {c.detail}</span>}
      </span>
      {href && <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
    </>
  );
  const row = "flex min-h-11 min-w-0 items-center gap-3 px-4 py-3";
  return <li>{href ? <Link href={href} className={cn(row, "transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none")}>{body}</Link> : <div className={row}>{body}</div>}</li>;
}

/**
 * «Cosa serve ancora»: le condizioni da sistemare, con il link dove si
 * sistemano; quelle già a posto chiuse sotto «N condizioni già a posto ▾».
 */
export function ViaConditionList({ open, done, doneText, hrefFor }: { open: readonly ViaConditionView[]; done: readonly ViaConditionView[]; doneText: string; hrefFor: (c: ViaConditionView) => string | null }) {
  return (
    <section aria-labelledby="uc-via-conditions" className="min-w-0 space-y-3">
      {open.length > 0 && (
        <>
          <h2 id="uc-via-conditions" className="text-base font-semibold">
            Cosa serve ancora
          </h2>
          <ul className={FRAME}>
            {open.map((c) => (
              <ConditionRow key={c.key} c={c} href={hrefFor(c)} />
            ))}
          </ul>
        </>
      )}
      {open.length === 0 && (
        <h2 id="uc-via-conditions" className="sr-only">
          Condizioni
        </h2>
      )}
      {done.length > 0 && (
        <details className="group/done min-w-0">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm text-muted-foreground select-none hover:text-foreground sm:min-h-9 [&::-webkit-details-marker]:hidden">
            <Check className="size-4 shrink-0 text-uc-verde" aria-hidden />
            {doneText}
            <ChevronRight className="size-3.5 transition-transform group-open/done:rotate-90" aria-hidden />
          </summary>
          <ul className={cn(FRAME, "mt-2")}>
            {done.map((c) => (
              <ConditionRow key={c.key} c={c} href={null} />
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/**
 * «Firme»: Lateral Space e cliente, firmato il giorno o da firmare. Mai nomi.
 * `note`: la riga grigia sotto, per la prova scritta che manca (casi a contratto).
 */
export function ViaSignatureList({ lines, note }: { lines: readonly ViaSignatureLine[]; note?: string | null }) {
  return (
    <section aria-labelledby="uc-via-signatures" className="min-w-0 space-y-3">
      <h2 id="uc-via-signatures" className="text-base font-semibold">
        Firme
      </h2>
      <dl className={FRAME}>
        {lines.map((l) => (
          <div key={l.side} className="flex min-h-11 items-center justify-between gap-3 px-4 py-2.5 text-sm">
            <dt className="min-w-0">{l.label}</dt>
            <dd className={cn("flex shrink-0 items-center gap-1.5", l.signed ? "text-foreground" : "text-muted-foreground")}>
              {l.signed && <Check className="size-4 text-uc-verde" aria-hidden />}
              {l.text}
            </dd>
          </div>
        ))}
      </dl>
      {note && <p className="text-sm text-muted-foreground">{note}</p>}
    </section>
  );
}

/** «Come funziona»: la regola, le tre eccezioni, chi firma e le 5 fasi con i loro stati. */
export function HowItWorks({
  rule,
  exceptions,
  signers,
  after,
  phases,
}: {
  rule: string;
  exceptions: readonly { label: string; text: string }[];
  signers: string;
  after: string;
  phases: readonly PhaseGroup[];
}) {
  return (
    <>
      <p className="text-sm">{rule}</p>
      <dl className="space-y-2 text-sm">
        {exceptions.map((e) => (
          <div key={e.label}>
            <dt className="font-medium">{e.label}</dt>
            <dd className="text-muted-foreground">{e.text}</dd>
          </div>
        ))}
      </dl>
      <p className="text-sm">
        {signers} {after}
      </p>
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Le fasi del caso</h3>
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
        <p className="text-sm text-muted-foreground">«In pausa» e «Chiuso» sono stati, non fasi: in pausa il caso riprende dallo stato in cui era.</p>
      </div>
    </>
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
