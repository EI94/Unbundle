import { Lightbulb, TriangleAlert } from "lucide-react";
import type { EvalRunOrigin } from "@/lib/db/queries/use-case-eval-origins";
import { formatCost, formatQuality, type BenchVerdict, type EvalOverview, type EvalRunView } from "@/lib/use-cases/factory/benchmark";
import { cn } from "@/lib/utils";
import { BenchChart } from "./bench-chart";
import {
  EVAL_TEXT,
  ciRunHref,
  evalSourceText,
  originOf,
  benchCommand,
  benchHeading,
  benchMetaLine,
  benchMissingText,
  benchRerunModels,
  benchRows,
  benchSupersededBy,
  benchSupersededText,
  changeHintParts,
  evalsAlertText,
  evalsCommand,
  evalsMetaLine,
  evalsResult,
  evalsStatusLine,
  formatLatency,
  groupsLine,
  hasMeasures,
  latestEvalsAlert,
  marksText,
  modelsByRole,
  rolesWithoutBench,
  rowSigns,
  sparkline,
  testsText,
  trendCaption,
  trendPoints,
  trendSentence,
  verdictTone,
  type BenchRow,
  type TrendPoint,
} from "./eval-format";

/**
 * «Evals e banco di prova» nel progetto dell'agente (rilascio 8.2a, docs/rilascio-8/BANCO-DI-PROVA.md §4.2), per tutti
 * quelli che vedono la pagina:
 *
 * - «Stato delle evals»: le evals che fanno lo stato del caso (`main` prima, poi i modelli veri, poi il livello
 *   completo: non sempre le più recenti): qualità, soglie, prove, data, ramo, livello, i modelli per ruolo, i
 *   segni dei modelli finti e del caso in costruzione, l'andamento (al massimo 12) in una piccola linea, l'avviso
 *   quando sono sotto soglia o in calo, e il comando per rifarle;
 * - per ogni ruolo l'ultimo banco: il grafico qualità contro costo, la tabella (modello · qualità · soglie · costo
 *   stimato per 1.000 · tempo p95 · segni), la raccomandazione (in evidenza quando conviene cambiare, con la riga di
 *   `agent.yaml`) e il comando per rifarlo con gli stessi modelli; un banco superato dalle evals di `main` (il ruolo
 *   usa un altro modello, o non c'è più) resta come storia, con una riga neutra al posto della raccomandazione;
 * - senza misure, i due comandi e a cosa servono, e (8.2b) che con la CI collegata le evals di main arrivano da sole;
 * - (8.2b) in fondo alla riga di ogni esecuzione la fonte, «dalla CI» o «dalla CLI» (`origins`, letti con
 *   `readEvalOrigins`; null: non si sa, e la riga non la dice). `ciLinks`: chi guarda costruisce il caso o è di Lateral
 *   Space, e «dalla CI» porta all'esecuzione su GitHub; il cliente lo legge senza link.
 *
 * Solo presentazione: legge quello che la pagina le passa (`readEvalOverview`). Per caso e per ruolo, mai per persona.
 */
export function EvalSection({
  overview,
  caseCode,
  unavailable = false,
  origins = null,
  ciLinks = false,
}: {
  overview: EvalOverview | null;
  caseCode: string;
  unavailable?: boolean;
  origins?: ReadonlyMap<string, EvalRunOrigin> | null;
  ciLinks?: boolean;
}) {
  const measured = hasMeasures(overview);
  // I ruoli delle evals di oggi senza un banco: il comando per cominciare, ruolo per ruolo.
  const missing = measured ? rolesWithoutBench(overview) : [];
  return (
    <div data-slot="eval-section" className="space-y-6">
      {unavailable ? (
        <p role="status" className="rounded-md border border-uc-giallo bg-uc-giallo-bg px-3 py-2 text-sm">
          {EVAL_TEXT.unavailable}
        </p>
      ) : null}
      {measured ? (
        <>
          <EvalsBlock evals={overview.evals} caseCode={caseCode} origin={overview.evals.latest ? originOf(origins, overview.evals.latest.id) : null} ciLinks={ciLinks} />
          {overview.benches.length ? (
            <>
              {overview.benches.map((bench) => (
                <BenchCard key={bench.role} bench={bench} latest={overview.evals.latest} caseCode={caseCode} origin={originOf(origins, bench.run.id)} ciLinks={ciLinks} />
              ))}
              {missing.map((role) => (
                <Command key={role} label={benchMissingText(role)} command={benchCommand(caseCode, role)} />
              ))}
            </>
          ) : (
            <NoBench caseCode={caseCode} roles={missing} />
          )}
        </>
      ) : (
        <EmptyState caseCode={caseCode} unavailable={unavailable} />
      )}
    </div>
  );
}

/** Un comando da lanciare nel repository del caso: tutto selezionato con un clic, va a capo se non sta. */
function Command({ label, command }: { label?: string; command: string }) {
  return (
    <p className="text-xs text-muted-foreground">
      {label ? `${label} ` : null}
      <code data-slot="eval-command" className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] break-words text-foreground select-all box-decoration-clone">
        {command}
      </code>
    </p>
  );
}

/**
 * (8.2b) « · dalla CI» o « · dalla CLI», in fondo alla riga di un'esecuzione. Per chi costruisce «dalla CI» porta
 * all'esecuzione su GitHub, con un bersaglio di 44 px al telefono che non allarga la riga; senza fonte, niente.
 * (Rilascio 10) La usa anche la riga di «Qualità» della Costruzione (`EvalSummary`).
 */
export function RunSource({ origin, ciLinks }: { origin: EvalRunOrigin | null; ciLinks: boolean }) {
  if (!origin) return null;
  const href = ciRunHref(origin, ciLinks);
  return (
    <>
      {" · "}
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          data-slot="eval-source"
          data-source={origin.source}
          className="-my-3.5 inline-block py-3.5 text-foreground underline underline-offset-2 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:my-0 sm:py-0"
        >
          {evalSourceText(origin.source)}
          <span className="sr-only">, {EVAL_TEXT.fromCiLink}</span>
        </a>
      ) : (
        <span data-slot="eval-source" data-source={origin.source}>
          {evalSourceText(origin.source)}
        </span>
      )}
    </>
  );
}

function FakeBadge() {
  return <p className="inline-flex rounded-full border border-uc-giallo bg-uc-giallo-bg px-2 py-0.5 text-xs">{EVAL_TEXT.fakeModels}</p>;
}

/** ✓ o ✗, con il colore del semaforo; il testo accanto dice cosa vuol dire. */
function ThresholdMark({ ok }: { ok: boolean }) {
  return (
    <span aria-hidden className={ok ? "text-uc-verde" : "text-uc-rosso"}>
      {ok ? "✓" : "✗"}
    </span>
  );
}

function EvalsBlock({ evals, caseCode, origin, ciLinks }: { evals: EvalOverview["evals"]; caseCode: string; origin: EvalRunOrigin | null; ciLinks: boolean }) {
  const latest = evals.latest;
  const result = latest ? evalsResult(latest) : null;
  if (!latest || !result) {
    return (
      <section aria-labelledby="banco-evals" className="space-y-2">
        <h3 id="banco-evals" className="text-sm font-medium">
          {EVAL_TEXT.evalsHeading}
        </h3>
        <p className="text-sm text-muted-foreground">{EVAL_TEXT.evalsNone}</p>
        <Command label={EVAL_TEXT.evalsStart} command={evalsCommand(caseCode)} />
      </section>
    );
  }
  const points = trendPoints(evals);
  const alert = evalsAlertText(latestEvalsAlert(evals));
  const groups = groupsLine(result.groups);
  const models = modelsByRole(latest.models);
  return (
    <section aria-labelledby="banco-evals" data-slot="eval-latest" className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 id="banco-evals" className="text-sm font-medium">
          {EVAL_TEXT.evalsHeading}
        </h3>
        <p className="text-xs text-muted-foreground">
          {evalsMetaLine(latest)}
          <RunSource origin={origin} ciLinks={ciLinks} />
        </p>
      </div>
      <p className="sr-only">{evalsStatusLine(latest, ", ")}.</p>
      <div aria-hidden className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="text-2xl font-semibold tracking-tight">{formatQuality(result.quality)}</p>
        <p className="text-sm">
          <ThresholdMark ok={result.thresholdsMet} /> {result.thresholdsMet ? EVAL_TEXT.thresholdsMet : EVAL_TEXT.thresholdsMissed}
          {result.total > 0 ? ` · ${testsText(result.passed, result.total)}` : ""}
        </p>
      </div>
      <Trend points={points} branch={latest.branch} />
      {groups ? <p className="text-xs text-muted-foreground">{groups}</p> : null}
      {models.length ? (
        <p className="text-xs text-muted-foreground">
          {EVAL_TEXT.models}: {models.map((m) => `${m.role} · ${m.label}`).join(", ")}
        </p>
      ) : null}
      {latest.fakeModels ? <FakeBadge /> : null}
      {latest.inConstruction ? <p className="text-xs text-muted-foreground">{EVAL_TEXT.inConstruction}</p> : null}
      {alert ? (
        <p data-slot="eval-alert" className="flex items-start gap-2 rounded-md border border-uc-giallo bg-uc-giallo-bg px-3 py-2 text-sm">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>{alert}</span>
        </p>
      ) : null}
      <Command label={EVAL_TEXT.evalsRerun} command={evalsCommand(caseCode, latest.level)} />
    </section>
  );
}

/** L'andamento in una piccola linea grigia, l'ultimo punto in colore; accanto da quanto a quanto, e tutti i valori per i lettori di schermo. */
function Trend({ points, branch }: { points: readonly TrendPoint[]; branch: string | null }) {
  const line = sparkline(points);
  const caption = trendCaption(points);
  const sentence = trendSentence(points, branch);
  if (!line || !caption || !sentence) return null;
  return (
    <div data-slot="eval-trend" className="flex items-center gap-2">
      <span aria-hidden className="relative block h-6 w-24 shrink-0">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible">
          <path d={line.path} className="fill-none stroke-uc-serie-altro" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </svg>
        <span className="absolute size-2 -translate-1/2 rounded-full bg-uc-serie-1 ring-2 ring-card" style={{ left: `${line.last.x}%`, top: `${line.last.y}%` }} />
      </span>
      <span aria-hidden className="text-xs text-muted-foreground tabular-nums">
        {caption}
      </span>
      <span className="sr-only">{sentence}</span>
    </div>
  );
}

function headingId(role: string): string {
  return `banco-ruolo-${role.replace(/[^a-z0-9_-]/gi, "-")}`;
}

/**
 * L'ultimo banco di un ruolo. Superato (dopo di lui le evals di `main` usano un altro modello per il ruolo, o non lo
 * hanno più): grafico e tabella restano come storia, senza «oggi», e una riga neutra prende il posto della
 * raccomandazione e della riga di `agent.yaml`; il comando per rifarlo solo se il ruolo c'è ancora.
 */
function BenchCard({
  bench,
  latest,
  caseCode,
  origin,
  ciLinks,
}: {
  bench: EvalOverview["benches"][number];
  latest: EvalRunView | null;
  caseCode: string;
  origin: EvalRunOrigin | null;
  ciLinks: boolean;
}) {
  const { role, run, analysis } = bench;
  const superseded = benchSupersededBy(bench, latest);
  const rows = benchRows(run.results, analysis, { superseded: superseded !== null });
  const id = headingId(role);
  return (
    <section aria-labelledby={id} data-slot="bench-card" data-role={role} className="min-w-0 space-y-3 border-t pt-4 sm:rounded-lg sm:border sm:p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 id={id} className="text-sm font-medium">
          {benchHeading(role)}
        </h3>
        <p className="text-xs text-muted-foreground">
          {benchMetaLine(run)}
          <RunSource origin={origin} ciLinks={ciLinks} />
        </p>
      </div>
      {run.fakeModels ? <FakeBadge /> : null}
      <BenchChart role={role} rows={rows} />
      <BenchTable role={role} rows={rows} />
      {superseded ? (
        <p data-slot="bench-superseded" className="text-sm break-words">
          {benchSupersededText(role, superseded.now)}
        </p>
      ) : (
        <Verdict role={role} verdict={analysis.verdict} />
      )}
      {superseded?.now === null ? null : <Command label={EVAL_TEXT.benchRerun} command={benchCommand(caseCode, role, run.level, benchRerunModels(run.results))} />}
    </section>
  );
}

/**
 * La tabella del banco, dal più bravo: modello (con «oggi»), qualità e prove, soglie, costo per 1.000, tempo p95 e i
 * segni. Nella scheda stretta i segni vanno sotto il nome, al posto della loro colonna.
 */
function BenchTable({ role, rows }: { role: string; rows: readonly BenchRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table data-slot="bench-table" className="w-full border-collapse text-left text-xs">
        <caption className="sr-only">{`I modelli del banco per il ruolo «${role}», dalla qualità più alta`}</caption>
        <thead>
          <tr className="border-b text-muted-foreground">
            <th scope="col" className="py-1.5 pr-1.5 align-bottom font-normal @md:pr-2">
              {EVAL_TEXT.columnModel}
            </th>
            <th scope="col" className="px-1.5 py-1.5 @md:px-2 text-right align-bottom font-normal">
              {EVAL_TEXT.columnQuality}
            </th>
            <th scope="col" className="px-1.5 py-1.5 @md:px-2 text-center align-bottom font-normal">
              {EVAL_TEXT.columnThresholds}
            </th>
            <th scope="col" className="px-1.5 py-1.5 @md:px-2 text-right align-bottom font-normal">
              {EVAL_TEXT.columnCost}
            </th>
            <th scope="col" className="px-1.5 py-1.5 @md:px-2 text-right align-bottom font-normal">
              {EVAL_TEXT.columnP95}
            </th>
            <th scope="col" className="hidden py-1.5 pl-2 align-bottom font-normal @xl:table-cell">
              {EVAL_TEXT.columnMarks}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((row) => {
            const signs = rowSigns(row);
            return (
              <tr key={row.model} data-model={row.model} className={row.thresholdsMet ? undefined : "text-muted-foreground"}>
                <th scope="row" className="py-2 pr-1.5 text-left align-top font-normal @md:pr-2">
                  <span className="font-medium break-words">{row.label}</span>
                  {row.current ? <span className="ml-1.5 inline-block rounded-full border px-1.5 text-[11px] whitespace-nowrap">oggi</span> : null}
                  {signs.length ? (
                    <span data-slot="bench-signs-narrow" className="block text-muted-foreground @xl:hidden">
                      {signs.map((sign) => (
                        <span key={sign} className="block whitespace-nowrap">
                          {sign}
                        </span>
                      ))}
                    </span>
                  ) : null}
                </th>
                <td className="px-1.5 py-2 @md:px-2 text-right align-top tabular-nums">
                  {formatQuality(row.quality)}
                  {row.passed !== null && row.total !== null ? <span className="block text-muted-foreground">{`${row.passed}/${row.total}`}</span> : null}
                </td>
                <td className="px-1.5 py-2 @md:px-2 text-center align-top">
                  <ThresholdMark ok={row.thresholdsMet} />
                  <span className="sr-only">{row.thresholdsMet ? EVAL_TEXT.thresholdsMet : EVAL_TEXT.thresholdsMissed}</span>
                </td>
                <td className="px-1.5 py-2 @md:px-2 text-right align-top tabular-nums">{row.cost !== null ? formatCost(row.cost) : EVAL_TEXT.unknownCost}</td>
                <td className="px-1.5 py-2 @md:px-2 text-right align-top tabular-nums">
                  {row.latencyP95Ms !== null ? (
                    formatLatency(row.latencyP95Ms)
                  ) : (
                    <>
                      <span aria-hidden>—</span>
                      <span className="sr-only">{EVAL_TEXT.notMeasured}</span>
                    </>
                  )}
                </td>
                <td className="hidden py-2 pl-2 align-top @xl:table-cell">{marksText(signs)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** La raccomandazione: in evidenza quando conviene cambiare (con la riga da cambiare), attenzione se nessuno passa. */
function Verdict({ role, verdict }: { role: string; verdict: BenchVerdict }) {
  const tone = verdictTone(verdict);
  const hint = verdict.kind === "cambia" ? changeHintParts(role, verdict.model) : null;
  return (
    <div
      data-slot="bench-verdict"
      data-verdict={verdict.kind}
      className={cn(
        "flex items-start gap-2 text-sm",
        tone === "cambia" && "rounded-md border border-uc-blu bg-uc-blu-bg p-3",
        tone === "attenzione" && "rounded-md border border-uc-giallo bg-uc-giallo-bg p-3",
      )}
    >
      {tone === "cambia" ? <Lightbulb aria-hidden className="mt-0.5 size-4 shrink-0" /> : tone === "attenzione" ? <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" /> : null}
      <div className="min-w-0 space-y-1">
        <p className="break-words">{verdict.text}</p>
        {hint ? (
          <p data-slot="bench-change-hint" className="text-xs break-words">
            Per cambiarlo: in <code className="font-mono">{hint.file}</code>, <code className="font-mono break-words">{hint.line}</code>, poi la pull request.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function NoBench({ caseCode, roles }: { caseCode: string; roles: readonly string[] }) {
  return (
    <section aria-labelledby="banco-nessuno" className="space-y-2">
      <h3 id="banco-nessuno" className="text-sm font-medium">
        {EVAL_TEXT.benchHeading}
      </h3>
      <p className="text-sm text-muted-foreground">{EVAL_TEXT.benchNone}</p>
      {roles.length ? (
        roles.map((role) => <Command key={role} label={`Per il ruolo «${role}»:`} command={benchCommand(caseCode, role)} />)
      ) : (
        <Command label={EVAL_TEXT.benchStart} command={benchCommand(caseCode, null)} />
      )}
    </section>
  );
}

/** Come si lanciano evals e banco. Se la lettura non è riuscita non dice «ancora nessuna misura»: non si sa. */
function EmptyState({ caseCode, unavailable }: { caseCode: string; unavailable: boolean }) {
  return (
    <div data-slot="eval-empty" className="space-y-3 text-sm">
      <p className="text-muted-foreground">{unavailable ? EVAL_TEXT.emptyIntroUnavailable : EVAL_TEXT.emptyIntro}</p>
      <ul className="space-y-3">
        <li className="space-y-1">
          <p>{EVAL_TEXT.emptyEvals}</p>
          <Command command={evalsCommand(caseCode)} />
        </li>
        <li className="space-y-1">
          <p>{EVAL_TEXT.emptyBench}</p>
          <Command command={benchCommand(caseCode, null)} />
        </li>
      </ul>
      <p data-slot="eval-empty-ci" className="text-xs text-muted-foreground">
        {EVAL_TEXT.emptyCi}
      </p>
    </div>
  );
}
