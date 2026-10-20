"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useUcAction } from "@/components/uc/catalog/use-uc-action";
import { DetailSheet } from "@/components/uc/ui/detail-sheet";
import { StatusDot } from "@/components/uc/ui/status-dot";
import { TechDetails } from "@/components/uc/ui/tech-details";
import { saveRoiAction } from "@/lib/actions/uc-value";
import { parseNumberIt } from "@/lib/uc/answers/number-it";
import type { Json } from "@/lib/uc/types";
import type { CostRowView, LeverRowView } from "@/lib/uc/views/roi";
import {
  COST_KINDS,
  COST_KIND_LABEL,
  LEVER_LABEL,
  LINE_STATUSES,
  LINE_STATUS_LABEL,
  VALUE_PANEL,
  newBenefitLine,
  roiInputProblems,
  roiUpdateInput,
  type BenefitLine,
  type CostLine,
} from "@/lib/uc/views/roi-edit";
import { LEVERS, type CaseRole } from "@/lib/uc/vocab";

/** Quello che serve per salvare il conto intero: le righe come sono adesso. */
export interface RoiSaveContext {
  workspaceId: string;
  caseId: string;
  costLines: CostLine[];
  benefitLines: BenefitLine[];
  content: Record<string, Json>;
  /** Il conto viene dallo schema di partenza: il primo salvataggio porta anche le righe di beneficio. */
  fromTemplate: boolean;
  /** `updated_at` del modello letto con la pagina; null se non c'è ancora un modello. */
  seen: string | null;
}

/** Le righe come le vede il pannello: la riga grezza arriva a parte, solo a chi la usa. */
export type CostRowPublic = Omit<CostRowView, "line">;
export type LeverRowPublic = Omit<LeverRowView, "line">;

interface PanelBase {
  /**
   * Solo per chi modifica il conto (responsabile Lateral Space, caso aperto e
   * non in pausa); per gli altri null, e righe e testi grezzi non arrivano al client.
   */
  save: RoiSaveContext | null;
  /** Pagina Valore senza parametri: dove si torna chiudendo il pannello. */
  baseHref: string;
  /** Il pannello si apre già in modifica (`&modifica=1`, la matita della riga). */
  editing: boolean;
  roles: readonly CaseRole[];
}

function readEuro(text: string): { value: number | null; error: string | null } {
  const t = text.replace(/€|eur/gi, "").trim();
  if (t === "") return { value: null, error: null };
  const parsed = parseNumberIt(t);
  return parsed.ok ? { value: parsed.value, error: null } : { value: null, error: parsed.errors[0]?.message ?? "Scrivi un numero." };
}

function euroText(n: number | null): string {
  return n === null ? "" : String(n).replace(".", ",");
}

/** Salva le righe e torna alla vista del pannello `nextPanel`. */
function useRoiSave(save: RoiSaveContext, baseHref: string) {
  const router = useRouter();
  const { pending, run } = useUcAction();
  const [problems, setProblems] = useState<string[]>([]);
  function submit(nextCosts: CostLine[], nextBenefits: BenefitLine[] | null, nextPanel: string, onDone: () => void) {
    const benefits = nextBenefits ?? (save.fromTemplate ? save.benefitLines : null);
    const issues = roiInputProblems(nextCosts, benefits);
    setProblems(issues);
    if (issues.length > 0) return;
    run(() => saveRoiAction(save.workspaceId, save.caseId, roiUpdateInput({ costLines: nextCosts, benefitLines: benefits, content: save.content, seen: save.seen })), {
      success: "Conto aggiornato.",
      onSuccess: () => {
        onDone();
        router.replace(`${baseHref}?apri=${encodeURIComponent(nextPanel)}`, { scroll: false });
      },
    });
  }
  return { pending, problems, submit };
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string | null }) {
  return (
    <label className="block space-y-1">
      <span className="block text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

function Problems({ problems }: { problems: string[] }) {
  if (problems.length === 0) return null;
  return (
    <ul className="space-y-1 rounded-md bg-uc-rosso-bg p-3 text-sm" role="alert">
      {problems.map((p) => (
        <li key={p}>{p}</li>
      ))}
    </ul>
  );
}

function ChoiceSelect<T extends string>({ id, value, onChange, items }: { id: string; value: T; onChange: (v: T) => void; items: readonly { value: T; label: string }[] }) {
  return (
    <Select items={items} value={value} onValueChange={(v) => v !== null && onChange(v as T)}>
      <SelectTrigger id={id} className="min-h-11 w-full sm:min-h-8">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const NONE = "__da_indicare__";

/** Riga «Etichetta: valore» del pannello, nascosta se il valore manca. */
function Line({ label, children }: { label: string; children: React.ReactNode }) {
  if (children === null || children === undefined || children === "") return null;
  return (
    <div className="min-w-0 space-y-0.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="text-sm break-words whitespace-pre-line">{children}</div>
    </div>
  );
}

function EditButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <Button type="button" variant="ghost" size="icon" className="size-11 shrink-0 sm:size-8" onClick={onClick} aria-label={label}>
      <Pencil aria-hidden />
    </Button>
  );
}

function FormButtons({ pending, invalid, label, onCancel }: { pending: boolean; invalid: boolean; label: string; onCancel: () => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button type="submit" className="min-h-11 sm:min-h-8" disabled={pending || invalid}>
        {label}
      </Button>
      <Button type="button" variant="ghost" className="min-h-11 sm:min-h-8" onClick={onCancel} disabled={pending}>
        Annulla
      </Button>
    </div>
  );
}

// ── Costo ─────────────────────────────────────────────────────────────

function CostForm({ line, panelId, save, baseHref, onDone }: { line: CostLine; panelId: string; save: RoiSaveContext; baseHref: string; onDone: () => void }) {
  const { pending, problems, submit } = useRoiSave(save, baseHref);
  const [kind, setKind] = useState<string>(line.kind ?? NONE);
  const [value, setValue] = useState(euroText(line.value));
  const [status, setStatus] = useState(line.status);
  const [authorized, setAuthorized] = useState(line.authorized === null ? NONE : line.authorized ? "si" : "no");
  const [how, setHow] = useState(line.howEstimated ?? "");
  const [source, setSource] = useState(line.source ?? "");
  const parsed = readEuro(value);
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const next: CostLine = {
          ...line,
          kind: kind === NONE ? null : (kind as CostLine["kind"]),
          value: parsed.value,
          status,
          authorized: authorized === NONE ? null : authorized === "si",
          howEstimated: how.trim() || null,
          source: source.trim() || null,
        };
        submit(
          save.costLines.map((c) => (c.key === line.key ? next : c)),
          null,
          panelId,
          onDone,
        );
      }}
    >
      <Problems problems={problems} />
      <Field label="Tipo di costo" hint={kind === NONE ? "Si può salvare anche senza: il conto resta «da calcolare» finché il tipo manca." : null}>
        <ChoiceSelect id="costo-tipo" value={kind} onChange={setKind} items={[{ value: NONE, label: "Da indicare" }, ...COST_KINDS.map((k) => ({ value: k, label: COST_KIND_LABEL[k] }))]} />
      </Field>
      <Field label={`Valore in euro${kind === "ricorrente" ? " all'anno" : ""}`}>
        <Input inputMode="decimal" className="min-h-11 sm:min-h-8" value={value} onChange={(e) => setValue(e.target.value)} placeholder="Es. 12.000" aria-invalid={parsed.error ? true : undefined} />
        {parsed.error && <span className="block text-xs text-uc-rosso">{parsed.error}</span>}
      </Field>
      <Field label="Stato del valore">
        <ChoiceSelect id="costo-stato" value={status} onChange={setStatus} items={LINE_STATUSES.map((s) => ({ value: s, label: LINE_STATUS_LABEL[s] }))} />
      </Field>
      <Field label="Approvata dal cliente">
        <ChoiceSelect
          id="costo-approvata"
          value={authorized}
          onChange={setAuthorized}
          items={[
            { value: NONE, label: "Da chiedere" },
            { value: "si", label: "Sì" },
            { value: "no", label: "No" },
          ]}
        />
      </Field>
      <Field label="Come si stima">
        <Textarea value={how} onChange={(e) => setHow(e.target.value)} maxLength={1000} rows={3} />
      </Field>
      <Field label="Fonte">
        <Input className="min-h-11 sm:min-h-8" value={source} onChange={(e) => setSource(e.target.value)} maxLength={500} />
      </Field>
      <FormButtons pending={pending} invalid={parsed.error !== null} label="Salva la riga" onCancel={onDone} />
    </form>
  );
}

/**
 * Pannello di una riga di costo (DESIGN §3.8): tipo, valore, «Come si stima»,
 * approvata dal cliente, fonte. Il responsabile Lateral Space la modifica con
 * la matita; chiave, voce collegata e testo dello schema in «Dettagli
 * tecnici». `line` (la riga grezza) arriva solo a Lateral Space.
 */
export function CostPanel({ row, line, save, baseHref, editing: startEditing, roles }: PanelBase & { row: CostRowPublic; line: CostLine | null }) {
  const canEdit = save !== null && line !== null;
  const [editing, setEditing] = useState(canEdit && startEditing);
  return (
    <DetailSheet title={row.label} closeHref={baseHref} description={editing ? "Riga di costo del conto." : row.kind}>
      {editing && save && line ? (
        <CostForm line={line} panelId={row.id} save={save} baseHref={baseHref} onDone={() => setEditing(false)} />
      ) : (
        <>
          <div className="flex items-start justify-between gap-3">
            <Line label="Valore">{row.value ?? row.valueNote}</Line>
            {canEdit && <EditButton onClick={() => setEditing(true)} label={`Modifica il costo ${row.label}`} />}
          </div>
          <Line label="Come si stima">{row.howEstimated}</Line>
          <Line label="Approvata dal cliente">{row.approved ?? "Da chiedere"}</Line>
          <Line label="Fonte">{row.source}</Line>
          <Line label="Stato del valore">{row.status}</Line>
          {line && (
            <TechDetails roles={roles} copyValue={line.key}>
              <p>Chiave: {line.key}</p>
              {line.itemKey && <p>Domanda collegata: {line.itemKey}</p>}
              {line.tipoTesto && <p>Tipo nello schema: {line.tipoTesto}</p>}
            </TechDetails>
          )}
        </>
      )}
    </DetailSheet>
  );
}

// ── Leva ──────────────────────────────────────────────────────────────

function LeverForm({ line, existing, save, baseHref, onDone }: { line: BenefitLine; existing: boolean; save: RoiSaveContext; baseHref: string; onDone: () => void }) {
  const { pending, problems, submit } = useRoiSave(save, baseHref);
  const [lever, setLever] = useState<string>(line.lever ?? NONE);
  const [value, setValue] = useState(euroText(line.value));
  const [status, setStatus] = useState(line.status);
  const [how, setHow] = useState(line.howToEuro ?? "");
  const [formula, setFormula] = useState(line.formula ?? "");
  const [source, setSource] = useState(line.source ?? "");
  const parsed = readEuro(value);
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const next: BenefitLine = {
          ...line,
          lever: lever === NONE ? null : (lever as BenefitLine["lever"]),
          value: parsed.value,
          status,
          howToEuro: how.trim() || null,
          formula: formula.trim() || null,
          source: source.trim() || null,
        };
        const lines = existing ? save.benefitLines.map((b) => (b.key === line.key ? next : b)) : [...save.benefitLines, next];
        submit(save.costLines, lines, `${VALUE_PANEL.lever}${next.key}`, onDone);
      }}
    >
      <Problems problems={problems} />
      <Field label="Leva">
        <ChoiceSelect
          id="leva-leva"
          value={lever}
          onChange={setLever}
          items={[{ value: NONE, label: line.leverLabel ? `Da indicare (nel caso: ${line.leverLabel})` : "Da indicare" }, ...LEVERS.map((l) => ({ value: l, label: LEVER_LABEL[l] }))]}
        />
      </Field>
      <Field label="Beneficio in euro all'anno">
        <Input inputMode="decimal" className="min-h-11 sm:min-h-8" value={value} onChange={(e) => setValue(e.target.value)} placeholder="Es. 40.000" aria-invalid={parsed.error ? true : undefined} />
        {parsed.error && <span className="block text-xs text-uc-rosso">{parsed.error}</span>}
      </Field>
      <Field label="Stato del valore">
        <ChoiceSelect id="leva-stato" value={status} onChange={setStatus} items={LINE_STATUSES.map((s) => ({ value: s, label: LINE_STATUS_LABEL[s] }))} />
      </Field>
      <Field label="Come diventa euro">
        <Textarea value={how} onChange={(e) => setHow(e.target.value)} maxLength={2000} rows={3} />
      </Field>
      <Field label="Formula">
        <Textarea value={formula} onChange={(e) => setFormula(e.target.value)} maxLength={2000} rows={2} />
      </Field>
      <Field label="Fonte">
        <Input className="min-h-11 sm:min-h-8" value={source} onChange={(e) => setSource(e.target.value)} maxLength={500} />
      </Field>
      <FormButtons pending={pending} invalid={parsed.error !== null} label="Salva la leva" onCancel={onDone} />
    </form>
  );
}

/**
 * Pannello di una leva (DESIGN §3.8): la descrizione della leva, «Si misura
 * con» (i KPI con un puntino ciascuno), «Come diventa euro», «€ all'anno» con
 * la matita per il responsabile Lateral Space; formula e dati necessari in
 * «Dettagli tecnici». Per una leva attiva senza riga (`hasLine` falso) la
 * matita crea la riga. `line` (la riga grezza) arriva solo a Lateral Space.
 */
export function LeverPanel({
  row,
  line,
  hasLine,
  save,
  baseHref,
  editing: startEditing,
  roles,
  kpiHref,
}: PanelBase & { row: LeverRowPublic; line: BenefitLine | null; hasLine: boolean; kpiHref: string | null }) {
  const canEdit = save !== null && (line !== null || !hasLine);
  const [editing, setEditing] = useState(canEdit && startEditing);
  return (
    <DetailSheet title={row.label} closeHref={baseHref} description={editing ? "Beneficio all'anno della leva, in euro." : undefined}>
      {editing && save ? (
        <LeverForm line={line ?? newBenefitLine(row.lever ?? "tempo", save.benefitLines)} existing={hasLine} save={save} baseHref={baseHref} onDone={() => setEditing(false)} />
      ) : (
        <>
          {row.description && <p className="text-sm break-words whitespace-pre-line">{row.description}</p>}
          {row.kpis.length > 0 && (
            <section className="space-y-1">
              <h3 className="text-xs text-muted-foreground">Si misura con</h3>
              <ul className="space-y-0.5">
                {row.kpis.map((k) => {
                  const dot = <StatusDot tone={k.dot.tone} label={k.title} size="md" title={k.dot.label} />;
                  return (
                    <li key={k.id}>
                      {kpiHref ? (
                        <Link
                          href={`${kpiHref}?apri=${k.id}`}
                          className="-mx-1 flex min-h-11 items-center rounded-md px-1 hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none sm:min-h-8"
                        >
                          {dot}
                          <span className="sr-only">, {k.dot.label}</span>
                        </Link>
                      ) : (
                        <span className="flex min-h-8 items-center">
                          {dot}
                          <span className="sr-only">, {k.dot.label}</span>
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
          <Line label="Come diventa euro">{row.howToEuro}</Line>
          <div className="flex items-start justify-between gap-3">
            <Line label="€ all'anno">{row.value ?? "da stimare"}</Line>
            {canEdit && <EditButton onClick={() => setEditing(true)} label={`Modifica la leva ${row.label}`} />}
          </div>
          {line && (
            <TechDetails roles={roles} copyValue={line.key}>
              <p>Chiave: {line.key}</p>
              {line.formula && <p className="whitespace-pre-wrap">Formula: {line.formula}</p>}
              {line.dataNeeded.length > 0 && <p>Dati necessari: {line.dataNeeded.join("; ")}</p>}
              {line.inputs.length > 0 && <p>KPI citati: {line.inputs.join(", ")}</p>}
              {line.unresolvedRefs.length > 0 && <p>Citati ma non nel caso: {line.unresolvedRefs.join(", ")}</p>}
              {line.example && <p className="whitespace-pre-wrap">Esempio illustrativo: {line.example}</p>}
              {line.source && <p>Fonte: {line.source}</p>}
              <p>Stato del valore: {LINE_STATUS_LABEL[line.status]}</p>
            </TechDetails>
          )}
        </>
      )}
    </DetailSheet>
  );
}
