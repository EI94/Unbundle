import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { ItemLink } from "@/components/uc/catalog/item-link";
import { itemPath } from "@/components/uc/catalog/paths";
import { LEVER_META } from "@/components/uc/common/lever-icons";
import { DetailSheet } from "@/components/uc/ui/detail-sheet";
import { TechDetails } from "@/components/uc/ui/tech-details";
import type { LinkedItem } from "@/lib/uc/views/item-detail";
import { KPI_READINESS_VIEW, pnlText, type KpiView } from "@/lib/uc/views/kpi";
import { PHASE_LABEL, PRIORITY_LABEL } from "@/lib/uc/views/labels";
import { canOpenItem } from "@/lib/uc/views/page-access";
import { plainText } from "@/lib/uc/views/roi";
import type { CaseRole } from "@/lib/uc/vocab";

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  if (children === null || children === undefined || children === "") return null;
  return (
    <div className="min-w-0 space-y-0.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="text-sm break-words whitespace-pre-line">{children}</div>
    </div>
  );
}

function Linked({ title, items, workspaceId, caseId, roles }: { title: string; items: LinkedItem[]; workspaceId: string; caseId: string; roles: readonly CaseRole[] }) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-0.5 font-sans">
      <p>
        {title} · {items.length}
      </p>
      <ul>
        {items.map((it) => (
          <li key={it.id}>
            <ItemLink workspaceId={workspaceId} caseId={caseId} item={it} canOpen={canOpenItem(roles, it.status)} showKey />
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Pannello di un KPI (DESIGN §3.8, `?apri=<id>`): in vista «Cos'è», la formula
 * in parole, unità, valore di partenza, obiettivo e misure; il resto (chiave,
 * formula tecnica, conto economico, collegamenti) in «Dettagli tecnici», per
 * Lateral Space. Chi apre il catalogo ha anche la pagina intera.
 */
export function KpiPanel({
  kpi,
  workspaceId,
  caseId,
  roles,
  closeHref,
  keyTitles,
}: {
  kpi: KpiView;
  workspaceId: string;
  caseId: string;
  roles: readonly CaseRole[];
  closeHref: string;
  keyTitles: ReadonlyMap<string, string>;
}) {
  const it = kpi.item;
  const dot = KPI_READINESS_VIEW[kpi.readiness];
  const clean = (t: string | null) => plainText(t, keyTitles);
  return (
    <DetailSheet
      title={it.title}
      status={dot}
      closeHref={closeHref}
      footer={
        it.canOpen ? (
          <Link href={itemPath(workspaceId, caseId, it.id)} className="inline-flex min-h-11 items-center gap-0.5 text-sm text-muted-foreground hover:text-foreground sm:min-h-0">
            Apri la pagina intera
            <ChevronRight className="size-3.5" aria-hidden />
          </Link>
        ) : undefined
      }
    >
      <Line label="Cos'è">{clean(it.explanation)}</Line>
      <Line label="Formula">{clean(kpi.formula)}</Line>
      <Line label="Unità">{kpi.unit}</Line>
      <div className="grid gap-4 sm:grid-cols-2">
        <Line label="Valore di partenza">{kpi.baseline}</Line>
        <Line label="Obiettivo">{kpi.target}</Line>
      </div>
      <section className="space-y-1">
        <p className="text-xs text-muted-foreground">Misure</p>
        {kpi.measurements.length === 0 ? (
          <p className="text-sm text-muted-foreground">Ancora nessuna misura: il valore di partenza si misura prima di fissare l&apos;obiettivo.</p>
        ) : (
          <ul className="divide-y text-sm">
            {kpi.measurements.map((m, i) => (
              <li key={i} className="flex flex-wrap justify-between gap-x-3 py-1.5">
                <span>
                  {m.phase} · {m.period}
                </span>
                <span className="tabular-nums">{m.suppressed ? <span className="text-muted-foreground">Sotto la soglia minima</span> : m.value}</span>
                {m.provisional && <span className="w-full text-xs text-muted-foreground">Provvisoria</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
      <TechDetails roles={roles} copyValue={it.key}>
        <p>Chiave: {it.key}</p>
        <p>
          {kpi.definition.label} · {kpi.data.label}
        </p>
        {it.why && <p className="font-sans whitespace-pre-line">Perché conta: {it.why}</p>}
        {/* Valore di partenza e obiettivo come li scrive lo schema, con i codici dei fatti e le chiavi. */}
        {it.fields.baseline && it.fields.baseline !== kpi.baseline && <p className="font-sans whitespace-pre-line">Valore di partenza nello schema: {it.fields.baseline}</p>}
        {it.fields.target && it.fields.target !== kpi.target && <p className="font-sans whitespace-pre-line">Obiettivo nello schema: {it.fields.target}</p>}
        {kpi.formulaTech && <p className="whitespace-pre-wrap">Formula tecnica: {kpi.formulaTech}</p>}
        {kpi.direction && <p>Direzione: {kpi.direction}</p>}
        {kpi.granularity && <p>Granularità: {kpi.granularity}</p>}
        {kpi.dimensions && <p>Dimensioni: {kpi.dimensions}</p>}
        {kpi.frequency && <p>Frequenza: {kpi.frequency}</p>}
        {it.ownerRoleLabel && <p>Chi risponde: {it.ownerRoleLabel}</p>}
        <p>Conto economico: {pnlText(kpi.pnl)}</p>
        {it.priority && <p>Priorità: {PRIORITY_LABEL[it.priority]}</p>}
        {it.levers.length > 0 && <p>Leve: {it.levers.map((l) => LEVER_META[l].label).join(", ")}</p>}
        {it.servesFor.length > 0 && <p>Serve per: {it.servesFor.map((p) => PHASE_LABEL[p]).join(", ")}</p>}
        {it.example && <p className="font-sans whitespace-pre-line">Esempio di calcolo: {it.example}</p>}
        <Linked title="Dati che servono" items={kpi.dataNeeded} workspaceId={workspaceId} caseId={caseId} roles={roles} />
        <Linked title="Da dove arrivano" items={kpi.sources} workspaceId={workspaceId} caseId={caseId} roles={roles} />
        <Linked title="Domande di conferma" items={kpi.confirmQuestions} workspaceId={workspaceId} caseId={caseId} roles={roles} />
      </TechDetails>
    </DetailSheet>
  );
}
