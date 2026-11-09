/**
 * Il PDF del SAL della pagina «Programma» (rilascio 7c): la prima vista su carta, per la riunione con la
 * leadership. Le stesse cifre e le stesse parole della pagina (`text.ts`), nessun numero in più.
 *
 * Due pagine al massimo: risultati, valore e costo con il pareggio e i costi, le iniziative, le persone,
 * gli obiettivi, cosa è cambiato, prossimi passi e decisioni per la leadership. Mai una persona, mai la
 * percentuale dello sviluppo di Lateral Space né come si divide il canone.
 * Modulo puro: import relativi `.ts`.
 */
import { ACCENT, GRAY, PdfBuilder, type TableColumn } from "../documents/pdf.ts";
import { formatEuro, formatInteger } from "../use-cases/format.ts";
import { monthLabel } from "../use-cases/value-calc.ts";
import { PILLAR_TEXT, PROGRAM_TEXT, formatHours, formatPct, kpiValueText, longDate, nextStepText, salChangeText, signedEuro, signedInteger } from "./text.ts";
import type { ProgramView } from "./view.ts";

const T = PROGRAM_TEXT;

/** «sal-topjet-2026-11-09.pdf». */
export function salFileName(view: Pick<ProgramView, "companyName" | "today">): string {
  const slug =
    view.companyName
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "azienda";
  return `sal-${slug}-${view.today}.pdf`;
}

function breakevenLine(view: ProgramView): string {
  const b = view.curve.base.breakeven;
  if (!b) return T.noBreakeven;
  if (b.kind === "subito") return T.breakevenNow;
  if (b.kind === "oltre") return T.breakevenBeyond(b.month);
  return `${T.breakeven} · ${monthLabel(b.month)}`;
}

/** Il PDF del SAL dalla pagina. */
export function salPdf(view: ProgramView): Buffer {
  const doc = new PdfBuilder();
  doc.precise = true;
  const r = view.results;
  const sal = view.lastSal;
  const since = (now: number | null, then: number | null | undefined, euro: boolean) =>
    now === null || then === null || then === undefined || !sal || Math.round(now - then) === 0 ? "" : ` (${euro ? signedEuro(now - then) : signedInteger(now - then)} ${T.sinceSal(sal.on)})`;

  doc.text("UNBUNDLE · PROGRAMMA · SAL", { size: 8, font: "B", color: ACCENT, after: 10 });
  doc.text(T.title, { size: 19, font: "B", lineGap: 5, after: 4 });
  doc.text(`${T.subtitle(view.companyName)} · ${longDate(view.today)}`, { size: 10, color: GRAY, after: 16 });

  doc.text(T.results, { size: 12, font: "B", after: 6 });
  doc.pairs([
    [T.estimated, `${formatEuro(r.estimated)}${since(r.estimated, sal?.estimated, true)}`],
    [T.inUse, r.inUseCount ? `${formatEuro(r.inUse)}${since(r.inUse, sal?.inUse, true)}` : `${T.noneInUse}${r.firstGoLive ? ` · ${T.firstGoLive(r.firstGoLive)}` : ""}`],
    [T.perEmployee, r.perEmployee === null ? T.employeesMissing : `${formatEuro(r.perEmployee)}${since(r.perEmployee, sal?.perEmployee, true)}`],
    [T.index, view.index.value === null ? "—" : `${view.index.value}/100${since(view.index.value, sal?.index, false)}`],
  ]);
  doc.text(
    view.index.pillars.map((p) => `${PILLAR_TEXT[p.pillar]} ${p.score === null ? "—" : Math.round(p.score)}`).join(" · "),
    { size: 8.5, color: GRAY, after: 12 },
  );

  doc.text(T.chart, { size: 12, font: "B", after: 6 });
  const c = view.costs;
  const last = view.curve.base.months.length - 1;
  doc.pairs([
    [T.breakeven, breakevenLine(view)],
    [`${T.value} a ${monthLabel(view.curve.base.months[last])}`, formatEuro(view.curve.base.value[last])],
    [`${T.cost} a ${monthLabel(view.curve.base.months[last])}`, formatEuro(view.curve.base.cost[last])],
    ["Costi fino a oggi", formatEuro(c.toDate)],
    ["Mantenimento all'anno di ciò che è in uso", formatEuro(c.runInUse)],
    ["Avvio degli use case non ancora in uso", formatEuro(c.buildPlanned)],
    ...(c.support ? ([[T.support, `${formatEuro(c.support.monthNow)} al mese`]] as [string, string][]) : []),
  ]);
  doc.spacer(8);

  doc.text(T.initiatives, { size: 12, font: "B", after: 6 });
  const columns: TableColumn[] = [
    { title: "", width: 2 },
    { title: T.colValue, width: 1.2 },
    { title: T.colOneoff, width: 1.2 },
    { title: T.colRun, width: 1.2 },
  ];
  const rows = view.initiatives.map((row) => [`${T.stage[row.stage]} · ${formatInteger(row.count)} use case`, formatEuro(row.value), formatEuro(row.oneoff), formatEuro(row.run)]);
  if (c.support) rows.push([`${T.support} · ${T.supportMonth(c.support.monthNow)}`, "—", "—", formatEuro(c.support.perYear)]);
  if (view.people.training) rows.push([`${T.training} · ${T.trainingLine(view.people.training.trained, view.people.training.hours)}`, "—", "—", "—"]);
  if (rows.length) doc.table(columns, rows);
  if (view.review.length) doc.text(`${T.review(view.review.length)}: ${view.review.map((x) => x.title).join(", ")}.`, { size: 9, after: 8 });

  doc.text(T.people, { size: 12, font: "B", after: 6 });
  const p = view.people;
  doc.pairs([
    ["Persone formate", p.training ? `${T.trained(p.training.trained, view.company.employees)}${p.trainedPct !== null ? ` · ${formatPct(p.trainedPct)}` : ""}` : "—"],
    ["Ore di formazione", p.training ? formatHours(p.training.hours) : "—"],
    ...(p.weeklyUsePct !== null ? ([["Uso settimanale dell'AI", formatPct(p.weeklyUsePct)]] as [string, string][]) : []),
    [T.levelsLabel, p.levels ? p.levels.bars.map((b) => `${b.label}: ${formatInteger(b.count)}`).join(" · ") : T.levelsHidden],
  ]);
  doc.spacer(8);

  if (view.objectives.length || view.kpis.length) {
    doc.text(T.goals, { size: 12, font: "B", after: 6 });
    const goalRows = [
      ...view.objectives.flatMap((o) => o.keyResults.map((kr) => [kr.title, kpiValueText(kr.base, kr.unit), kpiValueText(kr.now, kr.unit), kpiValueText(kr.target, kr.unit)])),
      ...view.kpis.map((k) => [k.label, kpiValueText(k.base, k.unit), kpiValueText(k.now, k.unit), kpiValueText(k.target, k.unit)]),
    ];
    doc.table([{ title: "", width: 2.4 }, { title: "Base", width: 1 }, { title: "Adesso", width: 1 }, { title: "Obiettivo", width: 1 }], goalRows);
  }

  doc.text(T.changedSince(view.sal.lastOn), { size: 12, font: "B", after: 6 });
  if (!view.sal.lastOn) doc.text(T.noSalYet, { size: 9.5, after: 8 });
  else if (!view.sal.changes.length) doc.text(T.nothingChanged, { size: 9.5, after: 8 });
  else for (const ch of view.sal.changes) doc.text(`· ${salChangeText(ch)}`, { size: 9.5 });
  doc.spacer(8);

  doc.text(T.nextSteps, { size: 12, font: "B", after: 6 });
  if (view.nextSteps.length) for (const s of view.nextSteps) doc.text(`- ${nextStepText(s, view.companyName)}`, { size: 9.5 });
  else doc.text("Niente da fare adesso.", { size: 9.5 });
  doc.spacer(8);

  doc.text(T.asks, { size: 12, font: "B", after: 6 });
  if (view.asks.length) for (const a of view.asks) doc.text(`- ${a.text}`, { size: 9.5 });
  else doc.text(T.noAsks, { size: 9.5 });
  doc.spacer(12);
  doc.text(T.sources, { size: 8, color: GRAY });

  return doc.finalize(`${view.companyName} · SAL del ${longDate(view.today)}`, { title: `Programma · ${view.companyName}`, subject: "SAL" });
}
