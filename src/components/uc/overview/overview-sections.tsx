import Link from "next/link";
import { CheckCircle2, ChevronRight, Lock, PenLine } from "lucide-react";
import { PhaseStrip } from "@/components/uc/ui/phase-strip";
import { ProgressToGate } from "@/components/uc/ui/progress-to-gate";
import { SectionHeading } from "@/components/uc/ui/section-heading";
import { StatusDot } from "@/components/uc/ui/status-dot";
import type { CasePhase } from "@/lib/uc/views/labels";
import { formatCountIt } from "@/lib/uc/views/format";
import { MODULE_BAR_CELLS, MODULE_ROWS_VISIBLE, BLOCKERS_VISIBLE, type MilestoneView, type ModuleProgressRow, type OverviewBlockerRow, type ViaProgress } from "@/lib/uc/views/progress";
import type { SemaforoColor } from "@/lib/uc/vocab";
import { cn } from "@/lib/utils";

/**
 * Le sezioni della Panoramica (DESIGN §3.4): componenti server di sola
 * presentazione. I dati arrivano già pronti da `views/progress.ts` e da
 * `uc-overview.ts`; i link arrivano già completi, e mancano a chi non può
 * aprire la pagina di destinazione. Nessuna chiave, nessun pulsante pieno: il
 * solo pulsante pieno della pagina è quello della testata.
 */

const ROW = "group flex min-h-11 w-full min-w-0 items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none";
const FRAME = "divide-y overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10";
const DETAILS_SUMMARY =
  "flex min-h-11 cursor-pointer list-none items-center gap-1 text-sm text-muted-foreground select-none hover:text-foreground sm:min-h-9 [&::-webkit-details-marker]:hidden";

function Chevron() {
  return <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />;
}

/** La riga discreta in cima per una settimana dopo il via approvato. */
export function ApprovedNote({ text }: { text: string }) {
  return (
    <p role="status" className="flex items-start gap-2 text-sm">
      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-uc-verde" aria-hidden />
      <span className="min-w-0">{text}</span>
    </p>
  );
}

/** «Serve la tua firma · 2 decisioni aspettano te»: un link, il pulsante pieno resta in testata. */
export function SignatureCallout({ text, href }: { text: string; href: string }) {
  return (
    <Link href={href} className={cn(FRAME, ROW, "divide-y-0")}>
      <PenLine className="size-4 shrink-0 text-uc-giallo" aria-hidden />
      <span className="min-w-0 flex-1 text-sm font-medium">{text}</span>
      <Chevron />
    </Link>
  );
}

/** «Via allo sviluppo»: il numero grande, la barra e i gruppi aperti come link ai segmenti di Domande. */
export function ViaSummary({
  progress,
  audience,
  detailsHref,
  questionsHref,
  showGroups,
  hint,
  note,
  emptyText,
}: {
  progress: ViaProgress;
  audience: "ls" | "cliente";
  /** `/via`, per chi la può aprire. */
  detailsHref: string | null;
  /** Domande del dossier: i conteggi diventano link a `?vista=<gruppo>`. */
  questionsHref: string | null;
  showGroups: boolean;
  /** «Si muove quando arrivano le prime risposte.» */
  hint: string | null;
  /** La riga dello sviluppatore sul catalogo validato. */
  note: string | null;
  /** Senza domande indispensabili: la riga per Lateral Space (`noRequiredText`); per gli altri null e niente riga. */
  emptyText: string | null;
}) {
  return (
    <section aria-labelledby="uc-overview-via" className="min-w-0 space-y-3">
      <SectionHeading id="uc-overview-via" title="Via allo sviluppo" action={detailsHref ? { label: "Dettagli", href: detailsHref } : undefined} />
      {note && <p className="text-sm">{note}</p>}
      {progress.required > 0 ? (
        <ProgressToGate ok={progress.ok} required={progress.required} inReview={progress.inReview} size="lg" audience={audience} />
      ) : (
        emptyText && <p className="text-sm text-muted-foreground">{emptyText}</p>
      )}
      {showGroups && progress.open.length > 0 && (
        <ul className="flex flex-wrap items-center gap-x-1 gap-y-1 text-sm text-muted-foreground" aria-label="Domande indispensabili non ancora a posto">
          {progress.open.map((g, i) => (
            <li key={g.group} className="flex items-center gap-1">
              {i > 0 && <span aria-hidden>·</span>}
              {questionsHref ? (
                <Link href={`${questionsHref}?vista=${g.slug}`} className="inline-flex min-h-11 items-center tabular-nums underline-offset-4 hover:text-foreground hover:underline sm:min-h-0">
                  {g.text}
                </Link>
              ) : (
                <span className="tabular-nums">{g.text}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
    </section>
  );
}

function MiniBar({ cells, label }: { cells: number; label: string }) {
  return (
    <span className="flex shrink-0 gap-0.5" role="img" aria-label={label}>
      {Array.from({ length: MODULE_BAR_CELLS }, (_, i) => (
        <span key={i} className={cn("h-2 w-2.5 rounded-[2px]", i < cells ? "bg-uc-verde" : "bg-muted")} />
      ))}
    </span>
  );
}

function ModuleRow({ row, href, showRole }: { row: ModuleProgressRow; href: string | null; showRole: boolean }) {
  const count = `${formatCountIt(row.ok)} di ${formatCountIt(row.total)}`;
  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium break-words">{row.title}</span>
        {showRole && row.roleLabel && <span className="block text-xs break-words text-muted-foreground sm:hidden">{row.roleLabel}</span>}
      </span>
      {showRole && row.roleLabel && <span className="hidden max-w-48 shrink-0 truncate text-xs text-muted-foreground sm:block">{row.roleLabel}</span>}
      <MiniBar cells={row.cells} label={`${count} a posto`} />
      <span className="w-16 shrink-0 text-right text-sm whitespace-nowrap tabular-nums">{count}</span>
      {href ? <Chevron /> : <span className="size-4 shrink-0" aria-hidden />}
    </>
  );
  return <li>{href ? <Link href={href} className={ROW}>{body}</Link> : <div className={ROW}>{body}</div>}</li>;
}

/** «Per argomento»: le prime righe in vista, le altre in «Tutti gli argomenti (n) ▾». */
export function ModuleProgressList({ rows, questionsHref, showRole }: { rows: readonly ModuleProgressRow[]; questionsHref: string | null; showRole: boolean }) {
  if (rows.length === 0) return null;
  const href = (r: ModuleProgressRow) => (questionsHref && r.key ? `${questionsHref}?argomento=${encodeURIComponent(r.key)}` : null);
  const first = rows.slice(0, MODULE_ROWS_VISIBLE);
  const rest = rows.slice(MODULE_ROWS_VISIBLE);
  return (
    <section aria-labelledby="uc-overview-topics" className="min-w-0 space-y-3">
      <SectionHeading id="uc-overview-topics" title="Per argomento" />
      <ul className={FRAME}>
        {first.map((r) => (
          <ModuleRow key={r.key ?? "altre"} row={r} href={href(r)} showRole={showRole} />
        ))}
      </ul>
      {rest.length > 0 && (
        <details className="group/more min-w-0">
          <summary className={DETAILS_SUMMARY}>
            Tutti gli argomenti ({formatCountIt(rows.length)})
            <ChevronRight className="size-3.5 transition-transform group-open/more:rotate-90" aria-hidden />
          </summary>
          <ul className={cn(FRAME, "mt-2")}>
            {rest.map((r) => (
              <ModuleRow key={r.key ?? "altre"} row={r} href={href(r)} showRole={showRole} />
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function BlockerRow({ row, href }: { row: OverviewBlockerRow; href: string }) {
  return (
    <li>
      <Link href={href} scroll={false} className={ROW}>
        <Lock className="size-4 shrink-0 text-uc-lucchetto" aria-hidden />
        <span className="min-w-0 flex-1 sm:flex sm:items-baseline sm:gap-3">
          <span className="block shrink-0 text-sm font-medium sm:w-48 sm:truncate">{row.label}</span>
          <span className="block text-sm text-muted-foreground">{row.line}</span>
        </span>
        <Chevron />
      </Link>
    </li>
  );
}

/** «Blocchi» (solo Lateral Space): al massimo due in vista, gli altri in «Altri n ▾». Ogni riga apre il suo pannello. */
export function BlockersSummary({ rows }: { rows: readonly (OverviewBlockerRow & { href: string })[] }) {
  if (rows.length === 0) return null;
  const first = rows.slice(0, BLOCKERS_VISIBLE);
  const rest = rows.slice(BLOCKERS_VISIBLE);
  return (
    <section id="blocchi" aria-labelledby="uc-overview-blockers" className="min-w-0 scroll-mt-40 space-y-3">
      <SectionHeading id="uc-overview-blockers" title="Blocchi" />
      <ul className={FRAME}>
        {first.map((r) => (
          <BlockerRow key={r.id} row={r} href={r.href} />
        ))}
      </ul>
      {rest.length > 0 && (
        <details className="group/more min-w-0">
          <summary className={DETAILS_SUMMARY}>
            {rest.length === 1 ? "Altro 1" : `Altri ${formatCountIt(rest.length)}`}
            <ChevronRight className="size-3.5 transition-transform group-open/more:rotate-90" aria-hidden />
          </summary>
          <ul className={cn(FRAME, "mt-2")}>
            {rest.map((r) => (
              <BlockerRow key={r.id} row={r} href={r.href} />
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/** Una tappa: titolo, quando e i suffissi grigi («(proposta)», «da confermare»). */
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

/** «Tappe»: la striscia delle 5 fasi, le prossime due tappe e «Tutte le tappe ›». */
export function MilestonesSummary({
  strip,
  state,
  next,
  allHref,
}: {
  strip: { phase: CasePhase; complete: boolean; paused: boolean } | null;
  /** «In pausa», «Chiuso»: uno stato, non una fase. */
  state: { tone: SemaforoColor; label: string } | null;
  next: readonly MilestoneView[];
  allHref: string | null;
}) {
  return (
    <section aria-labelledby="uc-overview-milestones" className="min-w-0 space-y-3">
      <SectionHeading id="uc-overview-milestones" title="Tappe" />
      {state && <StatusDot tone={state.tone} label={state.label} size="md" />}
      {strip && <PhaseStrip current={strip.phase} complete={strip.complete} paused={strip.paused} />}
      {next.length > 0 && (
        <ul className="space-y-2">
          {next.map((m) => (
            <li key={m.key}>
              <MilestoneLine m={m} />
            </li>
          ))}
        </ul>
      )}
      {allHref && (
        <Link href={allHref} scroll={false} className="inline-flex min-h-11 items-center gap-0.5 text-sm text-muted-foreground hover:text-foreground sm:min-h-0">
          Tutte le tappe
          <ChevronRight className="size-3.5" aria-hidden />
        </Link>
      )}
    </section>
  );
}

/** «Il caso»: «In breve» su 4 righe e «Leggi la descrizione ›». */
export function CaseSummary({ inBreve, descriptionHref }: { inBreve: string | null; descriptionHref: string | null }) {
  if (!inBreve && !descriptionHref) return null;
  return (
    <section aria-labelledby="uc-overview-case" className="min-w-0 space-y-3">
      <SectionHeading id="uc-overview-case" title="Il caso" />
      {inBreve && <p className="line-clamp-4 text-sm break-words whitespace-pre-line">{inBreve}</p>}
      {descriptionHref && (
        <Link href={descriptionHref} className="inline-flex min-h-11 items-center gap-0.5 text-sm text-muted-foreground hover:text-foreground sm:min-h-0">
          Leggi la descrizione
          <ChevronRight className="size-3.5" aria-hidden />
        </Link>
      )}
    </section>
  );
}
