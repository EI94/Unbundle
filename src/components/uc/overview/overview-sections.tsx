import Link from "next/link";
import { ChevronRight, Lock } from "lucide-react";
import { BigNumber } from "@/components/ui-10/big-number";
import { Row, RowList } from "@/components/ui-10/row";
import { Why } from "@/components/ui-10/why";
import { NextStepIconView } from "@/components/use-cases/detail/next-step-box";
import { StatusDot } from "@/components/uc/ui/status-dot";
import { formatCountIt } from "@/lib/uc/views/format";
import { BLOCKERS_VISIBLE, overviewBlockerTitle, topicOpenText, type MilestoneView, type ModuleProgressRow, type OverviewBlockerRow, type ViaConditionView } from "@/lib/uc/views/progress";
import type { TurnRow } from "@/lib/uc/views/next-step";
import type { NextStepIcon } from "@/lib/use-cases/guided";
import type { SemaforoColor } from "@/lib/uc/vocab";
import { cn } from "@/lib/utils";

/**
 * Le sezioni della Panoramica (rilascio 10, docs/ui-10/PROPOSTA-10.md §3.5,
 * prototipo S4): «Da fare», «Via allo sviluppo» (la vecchia `/via`), «Prossima
 * tappa», «Per argomento» e le righe dei blocchi. Componenti server di sola
 * presentazione: i testi arrivano già pronti da `views/progress.ts` e
 * `views/next-step.ts`, i link già completi e solo a chi può aprire la pagina
 * di destinazione. Nessun pulsante pieno qui: quello della pagina è il
 * prossimo passo della testata, o il comando della sezione «Via allo sviluppo»
 * (`GatePanel`) quando è lì. Le righe sono righe, non pulsanti.
 */

const H2 = "text-base font-semibold";
/** (Rilascio 10, §1 regola 4) Righe in vista in una lista della Panoramica, poi «Vedi tutti (n)». */
const ROWS_VISIBLE = 3;
const QUIET_LINK =
  "inline-flex min-h-11 items-center gap-0.5 rounded-md text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-8";

/** Le righe oltre le prime 3, chiuse sotto «Vedi tutti (n)» finché chi guarda non le apre. */
function MoreRows({ total, children }: { total: number; children: React.ReactNode }) {
  return (
    <details className="group/more min-w-0">
      <summary className={cn(QUIET_LINK, "cursor-pointer list-none select-none [&::-webkit-details-marker]:hidden")}>
        Vedi tutti ({formatCountIt(total)})
        <ChevronRight className="size-3.5 transition-transform group-open/more:rotate-90" aria-hidden />
      </summary>
      <RowList className="mt-2">{children}</RowList>
    </details>
  );
}

/** Il titolo di una sezione: un H2 vero, con qualcosa a destra (lo stato, il «?», il «⋯»). */
export function SectionTitle({ id, title, children }: { id: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex min-h-11 min-w-0 items-center justify-between gap-3 sm:min-h-9">
      <h2 id={id} className={H2}>
        {title}
      </h2>
      {children ? <div className="flex min-w-0 shrink-0 items-center gap-2">{children}</div> : null}
    </div>
  );
}

// ── Da fare ───────────────────────────────────────────────────────────

export interface TodoRow {
  key: string;
  label: string;
  href: string;
  icon: NextStepIcon;
  /** Il passo apre un pannello della stessa pagina (`?conferma=`, `?esporta=`): la pagina non torna in cima. */
  samePage?: boolean;
}

/**
 * «Da fare» (§3.5): al massimo 3 righe, i passi di chi guarda dopo il pulsante
 * pieno, con l'icona e il verbo; poi la riga «Tocca a …» per una cosa che
 * aspetta un'altra persona, senza freccia. Niente righe: niente sezione.
 */
export function OverviewTodo({ rows, turn }: { rows: readonly TodoRow[]; turn: TurnRow | null }) {
  if (rows.length === 0 && !turn) return null;
  return (
    <section aria-labelledby="uc-overview-todo" className="min-w-0 space-y-3">
      <SectionTitle id="uc-overview-todo" title="Da fare" />
      <RowList>
        {rows.map((r) => (
          <li key={r.key}>
            <Row href={r.href} scroll={r.samePage ? false : undefined} leading={<NextStepIconView icon={r.icon} className="size-4 text-muted-foreground" />} title={r.label} />
          </li>
        ))}
        {turn && (
          <li>
            <Row leading={<NextStepIconView icon="attesa" className="size-4 text-muted-foreground" />} title={turn.title} fact={turn.turn} />
          </li>
        )}
      </RowList>
    </section>
  );
}

// ── Via allo sviluppo ─────────────────────────────────────────────────

/** La barra del via: verde per «a posto», gialla al 40% per le risposte in verifica. */
export function GateBar({ ok, required, inReview, audience }: { ok: number; required: number; inReview: number; audience: "ls" | "cliente" }) {
  const total = Math.max(0, Math.round(required));
  if (total <= 0) return null;
  const clamp = (v: number, max: number) => Math.max(0, Math.min(max, Number.isFinite(v) ? Math.round(v) : 0));
  const done = clamp(ok, total);
  const review = clamp(inReview, total - done);
  const text = `${formatCountIt(done)} di ${formatCountIt(total)} domande indispensabili a posto${review > 0 ? `, ${formatCountIt(review)} ${audience === "cliente" ? "in verifica" : "da verificare"}` : ""}`;
  return (
    <span
      role="progressbar"
      aria-label="Domande indispensabili a posto"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={done}
      aria-valuetext={text}
      className="relative mt-3 flex h-1.5 w-full overflow-hidden rounded-full bg-muted"
    >
      <span className="h-full bg-uc-verde" style={{ width: `${(done / total) * 100}%` }} />
      {review > 0 && <span className="h-full bg-uc-giallo/40" style={{ width: `${(review / total) * 100}%` }} />}
    </span>
  );
}

/** Il numero grande del via («186 di 245», «domande indispensabili a posto») con la barra; senza domande, la riga per Lateral Space. */
export function ViaNumber({ ok, required, inReview, audience, emptyText }: { ok: number; required: number; inReview: number; audience: "ls" | "cliente"; emptyText: string | null }) {
  if (required <= 0) return emptyText ? <p className="text-sm text-muted-foreground">{emptyText}</p> : null;
  return (
    <div className="min-w-0">
      <BigNumber value={`${formatCountIt(Math.min(ok, required))} di ${formatCountIt(required)}`} label="domande indispensabili a posto" />
      <GateBar ok={ok} required={required} inReview={inReview} audience={audience} />
    </div>
  );
}

/** I gruppi del via come link a Domande: «Da fare 37 · Bloccate 13». */
export function ViaGroupLinks({ links, questionsHref }: { links: readonly { group: string; slug: string; text: string }[]; questionsHref: string | null }) {
  if (links.length === 0) return null;
  return (
    <ul className="flex flex-wrap items-center gap-x-1 text-sm text-muted-foreground" aria-label="Domande indispensabili non ancora a posto">
      {links.map((g, i) => (
        <li key={g.group} className="flex items-center gap-1">
          {i > 0 && <span aria-hidden>·</span>}
          {questionsHref ? (
            <Link href={`${questionsHref}?vista=${g.slug}`} className="inline-flex min-h-11 items-center tabular-nums underline-offset-4 hover:text-foreground hover:underline sm:min-h-8">
              {g.text}
            </Link>
          ) : (
            <span className="tabular-nums">{g.text}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * La riga dello stato del via, con il «?» di «Come funziona» (F-039): «Si
 * propone quando sono tutte a posto», le firme in una riga, «Approvato il 3
 * ott · catalogo v1».
 */
export function ViaStatusLine({ text, how }: { text: string; how: string }) {
  return (
    <div className="flex min-w-0 items-center gap-1 text-sm">
      <p className="min-w-0 break-words">{text}</p>
      <Why id="uc-via-come-funziona" text={how} label="Come funziona il via allo sviluppo" />
    </div>
  );
}

/**
 * Le condizioni del via ancora aperte (senza quella delle domande, che è il numero), con il link dove si sistemano.
 * Al massimo 3 in vista, poi «Vedi tutti (n)» (§1 regola 4).
 */
export function ViaConditions({ rows, hrefFor }: { rows: readonly ViaConditionView[]; hrefFor: (c: ViaConditionView) => string | null }) {
  if (rows.length === 0) return null;
  const row = (c: ViaConditionView) => (
    <li key={c.key}>
      <Row title={c.label} fact={c.detail} href={hrefFor(c) ?? undefined} />
    </li>
  );
  const first = rows.slice(0, ROWS_VISIBLE);
  const rest = rows.slice(ROWS_VISIBLE);
  return (
    <div className="min-w-0 space-y-2">
      <RowList label="Condizioni ancora aperte">{first.map(row)}</RowList>
      {rest.length > 0 && <MoreRows total={rows.length}>{rest.map(row)}</MoreRows>}
    </div>
  );
}

/** Lo stato del via accanto al titolo della sezione, quando non è «Non ancora». */
export function ViaState({ tone, label }: { tone: SemaforoColor; label: string }) {
  return <StatusDot tone={tone} label={label} size="md" />;
}

// ── Prossima tappa ────────────────────────────────────────────────────

/** Una tappa nel pannello «Tutte le tappe»: titolo, quando e i suffissi grigi («(proposta)», «da confermare»). */
export function MilestoneLine({ m }: { m: MilestoneView }) {
  return (
    <span className="flex min-w-0 flex-col gap-0.5 text-sm sm:flex-row sm:items-baseline sm:gap-3">
      <span className="min-w-0 break-words sm:w-56 sm:shrink-0">{m.title}</span>
      {(m.when || m.suffix) && (
        <span className="min-w-0 tabular-nums">
          {m.when}
          {m.suffix && <span className="text-muted-foreground">{m.when ? " " : ""}{m.suffix}</span>}
        </span>
      )}
    </span>
  );
}

/** «Prossima tappa»: una riga e «Tutte le tappe ›» (il pannello `?apri=tappe`). Senza tappa da fare, «Tappe» e il link. */
export function NextMilestone({ text, allHref }: { text: string | null; allHref: string | null }) {
  if (!text && !allHref) return null;
  return (
    <section aria-labelledby="uc-overview-milestone" className="min-w-0 space-y-2">
      <SectionTitle id="uc-overview-milestone" title={text ? "Prossima tappa" : "Tappe"} />
      {text && <p className="text-sm break-words tabular-nums">{text}</p>}
      {allHref && (
        <Link href={allHref} scroll={false} className={QUIET_LINK}>
          Tutte le tappe
          <ChevronRight className="size-3.5" aria-hidden />
        </Link>
      )}
    </section>
  );
}

// ── Per argomento ─────────────────────────────────────────────────────

/**
 * «Per argomento» (§3.5): i 3 argomenti con più domande indispensabili
 * aperte, ognuno verso Domande filtrata, e «Tutti gli argomenti (n) ›».
 */
export function TopicList({ rows, hrefFor, allHref, total }: { rows: readonly ModuleProgressRow[]; hrefFor: (r: ModuleProgressRow) => string | null; allHref: string | null; total: number }) {
  if (rows.length === 0) return null;
  return (
    <section aria-labelledby="uc-overview-topics" className="min-w-0 space-y-3">
      <SectionTitle id="uc-overview-topics" title="Per argomento" />
      <RowList>
        {rows.map((r) => (
          <li key={r.key ?? "altre"}>
            <Row title={r.title} fact={topicOpenText(r.missing)} href={hrefFor(r) ?? undefined} />
          </li>
        ))}
      </RowList>
      {allHref && total > rows.length && (
        <Link href={allHref} className={QUIET_LINK}>
          Tutti gli argomenti ({formatCountIt(total)})
          <ChevronRight className="size-3.5" aria-hidden />
        </Link>
      )}
    </section>
  );
}

// ── Blocchi ───────────────────────────────────────────────────────────

/**
 * Le righe dei blocchi (solo Lateral Space, ancora `#blocchi`): «Blocco:
 * Accesso al sistema ›», che apre il pannello del blocco. Al massimo 3, poi
 * «Vedi tutti (n)».
 */
export function BlockerList({ rows }: { rows: readonly (OverviewBlockerRow & { href: string })[] }) {
  if (rows.length === 0) return null;
  const first = rows.slice(0, BLOCKERS_VISIBLE);
  const rest = rows.slice(BLOCKERS_VISIBLE);
  const row = (r: OverviewBlockerRow & { href: string }) => (
    <li key={r.id}>
      <Row href={r.href} scroll={false} leading={<Lock className="size-4 text-uc-lucchetto" aria-hidden />} title={overviewBlockerTitle(r.label)} />
    </li>
  );
  return (
    <section id="blocchi" aria-label="Blocchi" className="min-w-0 scroll-mt-40 space-y-2">
      <RowList>{first.map(row)}</RowList>
      {rest.length > 0 && <MoreRows total={rows.length}>{rest.map(row)}</MoreRows>}
    </section>
  );
}
