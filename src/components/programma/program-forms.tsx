"use client";

import { useId, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  activateKpiAction,
  addCustomKpiAction,
  addKeyResultCheckinAction,
  closeSalAction,
  linkUseCaseToKeyResultAction,
  recordKpiValueAction,
  removeKpiAction,
  saveCaseDevAction,
  saveCompanyFactsAction,
  saveIndexWeightsAction,
  saveLeadershipAsksAction,
  saveLsCostsAction,
  setKeyResultBaseAction,
  updateKpiTargetsAction,
} from "@/lib/actions/use-case-program";
import { KPI_CATALOG, type KpiRow } from "@/lib/programma/kpis";
import { parseAsks, parseEmployees, parseLsCosts, parseRevenue, parseValue, parseWeights } from "@/lib/programma/inputs";
import { PILLAR_TEXT, PROGRAM_TEXT, longDate } from "@/lib/programma/text";
import type { ProgramView, ViewKeyResult } from "@/lib/programma/view";
import { INDEX_PILLARS, type IndexWeights } from "@/lib/programma/figures";
import { formatEuro, formatInteger } from "@/lib/use-cases/format";
import type { ServiceResult } from "@/lib/use-cases/types";
import { cn } from "@/lib/utils";

const T = PROGRAM_TEXT;

/** Le classi di un `<select>` nativo, come i campi. */
export const SELECT_CLASS =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";

/** Salva con una transizione: un toast all'errore, gli errori dei campi a chi li mostra, poi la pagina si aggiorna. */
function useSave() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  function run<T>(action: () => Promise<ServiceResult<T>>, onOk?: (value: T) => void, okText?: string) {
    start(async () => {
      try {
        const result = await action();
        if (result.ok) {
          setErrors({});
          if (okText) toast.success(okText);
          onOk?.(result.value);
          router.refresh();
        } else {
          setErrors(result.fieldErrors ?? {});
          if (!result.fieldErrors) toast.error(result.message);
        }
      } catch {
        toast.error("Non è stato salvato. Riprova tra poco.");
      }
    });
  }
  return { pending, errors, setErrors, run };
}

function FieldError({ id, text }: { id: string; text?: string }) {
  return text ? (
    <p id={id} className="text-xs text-destructive">
      {text}
    </p>
  ) : null;
}

function Field({ label, error, children, hint }: { label: string; error?: string; hint?: ReactNode; children: (ids: { id: string; describedBy?: string }) => ReactNode }) {
  const id = useId();
  const errId = `${id}-err`;
  return (
    <div className="min-w-0 space-y-1">
      <Label htmlFor={id} className="text-xs font-medium">
        {label}
      </Label>
      {children({ id, describedBy: error ? errId : undefined })}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      <FieldError id={errId} text={error} />
    </div>
  );
}

// ─── Dipendenti e ricavo ─────────────────────────────────────────────

/**
 * Una domanda del riquadro «Valore per dipendente»: prima i dipendenti (quando mancano), poi, una volta
 * sola e subito dopo, il ricavo (facoltativo, «Salta»). Un campo, «Salva». Chi non può scriverli vede solo
 * che mancano. Il passo lo tiene la pagina (`onEmployeesSaved`): dopo il salvataggio la pagina si aggiorna
 * e il riquadro mostra già il numero, con la domanda sul ricavo sotto.
 */
export function FactAsk({
  workspaceId,
  company,
  canEdit,
  step,
  onEmployeesSaved,
  onDone,
}: {
  workspaceId: string;
  company: string;
  canEdit: boolean;
  step: "dipendenti" | "ricavo";
  onEmployeesSaved?: () => void;
  onDone?: () => void;
}) {
  const [text, setText] = useState("");
  const { pending, errors, setErrors, run } = useSave();
  const id = useId();
  if (!canEdit) return step === "dipendenti" ? <p className="text-sm text-muted-foreground">{T.employeesMissing}</p> : null;
  const key = step === "dipendenti" ? "employees" : "revenue";
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (step === "dipendenti") {
      const parsed = parseEmployees(text);
      if (!parsed.ok) return setErrors({ employees: parsed.error });
      run(() => saveCompanyFactsAction(workspaceId, { employees: text }), () => {
        setText("");
        onEmployeesSaved?.();
      });
    } else {
      const parsed = parseRevenue(text);
      if (!parsed.ok) return setErrors({ revenue: parsed.error });
      run(() => saveCompanyFactsAction(workspaceId, { revenue: text }), () => onDone?.(), "Ricavo salvato.");
    }
  };
  return (
    <form onSubmit={submit} className="space-y-1.5" data-slot={step === "dipendenti" ? "employees-ask" : "revenue-ask"}>
      <Label htmlFor={`${id}-${key}`} className="text-sm font-normal">
        {step === "dipendenti" ? T.employeesAsk(company) : T.revenueAsk}
      </Label>
      <div className="flex flex-wrap gap-1.5">
        <Input
          id={`${id}-${key}`}
          inputMode="numeric"
          autoComplete="off"
          autoFocus={step === "ricavo"}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={step === "dipendenti" ? T.employeesPlaceholder : T.revenuePlaceholder}
          aria-invalid={errors[key] ? true : undefined}
          aria-describedby={errors[key] ? `${id}-${key}-err` : undefined}
          className="h-11 min-w-0 flex-1 basis-32 sm:h-8"
        />
        <Button type="submit" variant="outline" disabled={pending || !text.trim()} className="min-h-11 sm:min-h-8">
          {T.save}
        </Button>
        {step === "ricavo" ? (
          <Button type="button" variant="ghost" onClick={() => onDone?.()} className="min-h-11 sm:min-h-8">
            {T.skip}
          </Button>
        ) : null}
      </div>
      <FieldError id={`${id}-${key}-err`} text={errors[key]} />
    </form>
  );
}

/** Nel pannello: dipendenti e ricavo, con la loro fonte, da cambiare. */
export function FactsEditor({ view }: { view: ProgramView }) {
  const [employees, setEmployees] = useState(view.company.employees ? formatInteger(view.company.employees) : "");
  const [revenue, setRevenue] = useState(view.company.revenueEur ? formatInteger(view.company.revenueEur) : "");
  const { pending, errors, setErrors, run } = useSave();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const e = parseEmployees(employees);
    const r = parseRevenue(revenue);
    const fieldErrors: Record<string, string> = {};
    if (!e.ok) fieldErrors.employees = e.error;
    if (!r.ok) fieldErrors.revenue = r.error;
    if (Object.keys(fieldErrors).length) return setErrors(fieldErrors);
    run(() => saveCompanyFactsAction(view.workspaceId, { employees, revenue }), undefined, "Salvato.");
  };
  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
      <Field label="Dipendenti" error={errors.employees}>
        {({ id, describedBy }) => <Input id={id} inputMode="numeric" value={employees} onChange={(e) => setEmployees(e.target.value)} aria-describedby={describedBy} aria-invalid={describedBy ? true : undefined} />}
      </Field>
      <Field label="Ricavo dell'ultimo anno (facoltativo)" error={errors.revenue}>
        {({ id, describedBy }) => <Input id={id} inputMode="numeric" value={revenue} onChange={(e) => setRevenue(e.target.value)} placeholder="12 mln" aria-describedby={describedBy} aria-invalid={describedBy ? true : undefined} />}
      </Field>
      <div className="sm:col-span-2">
        <Button type="submit" variant="outline" disabled={pending}>
          {T.save}
        </Button>
      </div>
    </form>
  );
}

// ─── Costi di Lateral Space ──────────────────────────────────────────

/** Canone di supporto, periodo e percentuale dello sviluppo: solo Lateral Space. */
export function LsCostsForm({ view }: { view: ProgramView }) {
  const ls = view.ls!;
  const [texts, setTexts] = useState({
    supportMonthEur: ls.supportMonthEur !== null ? ls.supportMonthEur.toLocaleString("it-IT", { maximumFractionDigits: 2 }) : "",
    supportFrom: ls.supportFrom ?? "",
    supportTo: ls.supportTo ?? "",
    devPct: ls.devPct !== null ? String(ls.devPct).replace(".", ",") : "",
  });
  const { pending, errors, setErrors, run } = useSave();
  const set = (key: keyof typeof texts) => (e: { target: { value: string } }) => setTexts((t) => ({ ...t, [key]: e.target.value }));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const parsed = parseLsCosts(texts);
    if (!parsed.ok) return setErrors(parsed.fieldErrors as Record<string, string>);
    run(() => saveLsCostsAction(view.workspaceId, texts), undefined, "Costi salvati.");
  };
  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2" data-slot="ls-costs-form">
      <Field label="Canone di supporto, al mese" error={errors.supportMonthEur} hint="Esclude lo sviluppo dei singoli use case.">
        {({ id, describedBy }) => <Input id={id} inputMode="decimal" value={texts.supportMonthEur} onChange={set("supportMonthEur")} placeholder="4.000" aria-describedby={describedBy} aria-invalid={describedBy ? true : undefined} />}
      </Field>
      <Field label="Sviluppo, % del valore all'anno" error={errors.devPct} hint="Vale per gli use case in cui lo accendi.">
        {({ id, describedBy }) => <Input id={id} inputMode="decimal" value={texts.devPct} onChange={set("devPct")} placeholder="15" aria-describedby={describedBy} aria-invalid={describedBy ? true : undefined} />}
      </Field>
      <Field label="Canone dal mese" error={errors.supportFrom}>
        {({ id, describedBy }) => <Input id={id} type="month" value={texts.supportFrom} onChange={set("supportFrom")} aria-describedby={describedBy} aria-invalid={describedBy ? true : undefined} />}
      </Field>
      <Field label="Fino al mese (vuoto: senza fine)" error={errors.supportTo}>
        {({ id, describedBy }) => <Input id={id} type="month" value={texts.supportTo} onChange={set("supportTo")} aria-describedby={describedBy} aria-invalid={describedBy ? true : undefined} />}
      </Field>
      <div className="sm:col-span-2">
        <Button type="submit" variant="outline" disabled={pending}>
          {T.save}
        </Button>
      </div>
    </form>
  );
}

type CaseDevItem = NonNullable<ProgramView["ls"]>["caseDev"][number];

/** Lo sviluppo di Lateral Space di uno use case: nessuno, a percentuale, a importo fisso. */
export function CaseDevControl({ workspaceId, item, devPct }: { workspaceId: string; item: CaseDevItem; devPct: number | null }) {
  const [mode, setMode] = useState<"nessuno" | "percentuale" | "importo">(item.mode ?? "nessuno");
  const [amount, setAmount] = useState(item.amountEur !== null ? String(item.amountEur).replace(".", ",") : "");
  const { pending, errors, run } = useSave();
  const id = useId();
  const changed = mode !== (item.mode ?? "nessuno") || (mode === "importo" && amount !== (item.amountEur !== null ? String(item.amountEur).replace(".", ",") : ""));
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-slot="case-dev">
      <label htmlFor={`${id}-mode`} className="sr-only">
        Sviluppo Lateral Space di {item.title}
      </label>
      <select id={`${id}-mode`} className={cn(SELECT_CLASS, "w-auto")} value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
        <option value="nessuno">Nessuno sviluppo</option>
        <option value="percentuale">{devPct !== null ? `${String(devPct).replace(".", ",")} % del valore` : "A percentuale"}</option>
        <option value="importo">Importo fisso</option>
      </select>
      {mode === "importo" ? (
        <>
          <label htmlFor={`${id}-amount`} className="sr-only">
            Importo
          </label>
          <Input id={`${id}-amount`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="€" className="w-28" aria-invalid={errors.amountEur ? true : undefined} />
        </>
      ) : null}
      {changed ? (
        <Button type="button" size="sm" className="min-h-11 sm:min-h-7" variant="outline" disabled={pending} onClick={() => run(() => saveCaseDevAction(workspaceId, item.id, mode, amount), undefined, "Salvato.")}>
          {T.save}
        </Button>
      ) : null}
      {errors.amountEur ? <span className="text-xs text-destructive">{errors.amountEur}</span> : null}
      {mode === "percentuale" && devPct === null ? <span className="text-xs text-muted-foreground">Manca la percentuale del workspace.</span> : null}
    </div>
  );
}

/** I pesi dell'indice: solo Lateral Space. */
export function WeightsForm({ workspaceId, weights }: { workspaceId: string; weights: IndexWeights }) {
  const [texts, setTexts] = useState<Record<keyof IndexWeights, string>>({
    persone: String(weights.persone),
    use_case: String(weights.use_case),
    valore: String(weights.valore),
    adozione: String(weights.adozione),
  });
  const { pending, errors, setErrors, run } = useSave();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const parsed = parseWeights(texts);
    if (!parsed.ok) return setErrors({ weights: parsed.error });
    run(() => saveIndexWeightsAction(workspaceId, texts), undefined, "Pesi salvati.");
  };
  return (
    <form onSubmit={submit} className="space-y-2" data-slot="weights-form">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {INDEX_PILLARS.map((pillar) => (
          <Field key={pillar} label={PILLAR_TEXT[pillar]}>
            {({ id }) => <Input id={id} inputMode="numeric" value={texts[pillar]} onChange={(e) => setTexts((t) => ({ ...t, [pillar]: e.target.value }))} />}
          </Field>
        ))}
      </div>
      <FieldError id="weights-err" text={errors.weights} />
      <Button type="submit" variant="outline" disabled={pending}>
        {T.save}
      </Button>
    </form>
  );
}

// ─── Decisioni per la leadership ─────────────────────────────────────

const newId = () => Math.random().toString(36).slice(2, 10);

/** Le decisioni da chiedere alla leadership: una riga per decisione, scritte a mano. */
export function AsksEditor({ workspaceId, asks, canEdit }: { workspaceId: string; asks: ProgramView["asks"]; canEdit: boolean }) {
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState(asks);
  const { pending, errors, setErrors, run } = useSave();
  if (!editing) {
    return (
      <div className="space-y-2">
        {asks.length ? (
          <ul className="space-y-1.5 text-sm">
            {asks.map((a) => (
              <li key={a.id} className="flex gap-2">
                <span aria-hidden className="text-muted-foreground">
                  ◆
                </span>
                <span className="min-w-0 break-words">{a.text}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{T.noAsks}</p>
        )}
        {canEdit ? (
          <Button type="button" variant="ghost" size="sm" className="min-h-11 sm:min-h-7 -ml-2" onClick={() => { setRows(asks.length ? asks : [{ id: newId(), text: "" }]); setEditing(true); }}>
            {asks.length ? T.edit : T.addAsk}
          </Button>
        ) : null}
      </div>
    );
  }
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const parsed = parseAsks(rows);
    if (!parsed.ok) return setErrors({ asks: parsed.error });
    run(() => saveLeadershipAsksAction(workspaceId, parsed.value), () => setEditing(false));
  };
  return (
    <form onSubmit={submit} className="space-y-2" data-slot="asks-editor">
      {rows.map((row, index) => (
        <div key={row.id} className="flex gap-1.5">
          <label htmlFor={`ask-${row.id}`} className="sr-only">
            Decisione {index + 1}
          </label>
          <Input id={`ask-${row.id}`} value={row.text} maxLength={200} onChange={(e) => setRows((r) => r.map((x) => (x.id === row.id ? { ...x, text: e.target.value } : x)))} />
          <Button type="button" variant="ghost" size="sm" className="min-h-11 sm:min-h-7" onClick={() => setRows((r) => r.filter((x) => x.id !== row.id))} aria-label={`Togli la decisione ${index + 1}`}>
            ✕
          </Button>
        </div>
      ))}
      <FieldError id="asks-err" text={errors.asks} />
      <div className="flex flex-wrap gap-1.5">
        {rows.length < 8 ? (
          <Button type="button" variant="ghost" size="sm" className="min-h-11 sm:min-h-7" onClick={() => setRows((r) => [...r, { id: newId(), text: "" }])}>
            {T.addAsk}
          </Button>
        ) : null}
        <Button type="submit" variant="outline" size="sm" className="min-h-11 sm:min-h-7" disabled={pending}>
          {T.save}
        </Button>
        <Button type="button" variant="ghost" size="sm" className="min-h-11 sm:min-h-7" onClick={() => setEditing(false)}>
          {T.cancel}
        </Button>
      </div>
    </form>
  );
}

// ─── SAL ─────────────────────────────────────────────────────────────

/** «Chiudi il SAL»: chiede conferma con una riga, poi fotografa i numeri di oggi. */
export function CloseSalButton({ workspaceId, filled }: { workspaceId: string; filled: boolean }) {
  const [confirm, setConfirm] = useState(false);
  const { pending, run } = useSave();
  if (!confirm) {
    return (
      <Button type="button" variant={filled ? "default" : "outline"} onClick={() => setConfirm(true)} className="min-h-11 sm:min-h-8">
        {T.closeSal}
      </Button>
    );
  }
  return (
    <div className="space-y-2 rounded-lg border bg-muted/40 p-3" role="group" aria-label={T.closeSal}>
      <p className="text-sm">{T.closeSalHint}</p>
      <div className="flex gap-1.5">
        <Button type="button" className="min-h-11 sm:min-h-8" disabled={pending} onClick={() => run(() => closeSalAction(workspaceId), (v) => { setConfirm(false); toast.success(T.salClosed(v.on)); })}>
          {T.closeSal}
        </Button>
        <Button type="button" variant="ghost" className="min-h-11 sm:min-h-8" onClick={() => setConfirm(false)}>
          {T.cancel}
        </Button>
      </div>
    </div>
  );
}

// ─── KPI ─────────────────────────────────────────────────────────────

/** Il catalogo dei KPI: quelli non ancora attivi, con «Attiva». */
export function KpiCatalog({ workspaceId, active }: { workspaceId: string; active: readonly KpiRow[] }) {
  const { pending, run } = useSave();
  const keys = new Set(active.map((k) => k.key));
  const free = KPI_CATALOG.filter((k) => !keys.has(k.key));
  if (!free.length) return <p className="text-sm text-muted-foreground">Tutti i KPI del catalogo sono attivi.</p>;
  return (
    <ul className="divide-y rounded-lg border" data-slot="kpi-catalog">
      {free.map((k) => (
        <li key={k.key} className="flex items-center justify-between gap-3 px-3 py-2">
          <div className="min-w-0">
            <p className="text-sm font-medium">{k.label}</p>
            <p className="text-xs text-muted-foreground">
              {k.kind === "risultato" ? "Risultato" : "Iniziativa"} · {k.source === "automatico" ? "automatico" : "a mano"} · {k.hint}
            </p>
          </div>
          <Button type="button" size="sm" className="min-h-11 sm:min-h-7" variant="outline" disabled={pending} onClick={() => run(() => activateKpiAction(workspaceId, k.key), undefined, `${k.label}: attivo.`)}>
            Attiva
          </Button>
        </li>
      ))}
    </ul>
  );
}

/** Un KPI personalizzato: nome, unità, tipo, verso, formula facoltativa (senza formula si scrive a mano). */
export function CustomKpiForm({ workspaceId }: { workspaceId: string }) {
  const [open, setOpen] = useState(false);
  const [texts, setTexts] = useState({ label: "", unit: "", kind: "risultato", direction: "su", formula: "" });
  const { pending, errors, run } = useSave();
  if (!open) {
    return (
      <Button type="button" variant="ghost" size="sm" className="min-h-11 sm:min-h-7 -ml-2" onClick={() => setOpen(true)}>
        Aggiungi un KPI tuo
      </Button>
    );
  }
  const set = (key: keyof typeof texts) => (e: { target: { value: string } }) => setTexts((t) => ({ ...t, [key]: e.target.value }));
  return (
    <form
      className="grid gap-2 rounded-lg border p-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => addCustomKpiAction(workspaceId, texts), () => { setOpen(false); setTexts({ label: "", unit: "", kind: "risultato", direction: "su", formula: "" }); }, "KPI aggiunto.");
      }}
      data-slot="custom-kpi"
    >
      <Field label="Nome" error={errors.label}>
        {({ id }) => <Input id={id} value={texts.label} onChange={set("label")} maxLength={120} />}
      </Field>
      <Field label="Unità (€, %, giorni…)" error={errors.unit}>
        {({ id }) => <Input id={id} value={texts.unit} onChange={set("unit")} maxLength={16} />}
      </Field>
      <Field label="Tipo" error={errors.kind}>
        {({ id }) => (
          <select id={id} className={SELECT_CLASS} value={texts.kind} onChange={set("kind")}>
            <option value="risultato">Risultato</option>
            <option value="iniziativa">Iniziativa</option>
          </select>
        )}
      </Field>
      <Field label="Meglio se" error={errors.direction}>
        {({ id }) => (
          <select id={id} className={SELECT_CLASS} value={texts.direction} onChange={set("direction")}>
            <option value="su">sale</option>
            <option value="giu">scende</option>
          </select>
        )}
      </Field>
      <div className="sm:col-span-2">
        <Field label="Formula (facoltativa)" error={errors.formula} hint="Per esempio valore_in_uso / dipendenti. Senza formula il valore si scrive a mano ogni mese.">
          {({ id }) => <Input id={id} value={texts.formula} onChange={set("formula")} className="font-mono" />}
        </Field>
      </div>
      <div className="flex gap-1.5 sm:col-span-2">
        <Button type="submit" variant="outline" size="sm" className="min-h-11 sm:min-h-7" disabled={pending || !texts.label.trim()}>
          {T.save}
        </Button>
        <Button type="button" variant="ghost" size="sm" className="min-h-11 sm:min-h-7" onClick={() => setOpen(false)}>
          {T.cancel}
        </Button>
      </div>
    </form>
  );
}

/** Base, obiettivo, risultato chiave; per i KPI a mano, il valore del mese. «Togli». */
export function KpiEditor({ workspaceId, kpi, keyResults, month }: { workspaceId: string; kpi: KpiRow; keyResults: ReadonlyArray<{ id: string; title: string }>; month: string }) {
  const [texts, setTexts] = useState({ base: kpi.base !== null ? String(kpi.base).replace(".", ",") : "", target: kpi.target !== null ? String(kpi.target).replace(".", ",") : "", keyResultId: kpi.keyResultId ?? "" });
  const [value, setValue] = useState("");
  const [period, setPeriod] = useState(month);
  const { pending, errors, run } = useSave();
  const set = (key: keyof typeof texts) => (e: { target: { value: string } }) => setTexts((t) => ({ ...t, [key]: e.target.value }));
  return (
    <div className="space-y-3" data-slot="kpi-editor">
      {kpi.source === "manuale" ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const parsed = parseValue(value);
            if (!parsed.ok) return;
            run(() => recordKpiValueAction(workspaceId, kpi.id, period, value), () => setValue(""), "Valore salvato.");
          }}
        >
          <Field label="Mese" error={errors.period}>
            {({ id }) => <Input id={id} type="month" value={period} onChange={(e) => setPeriod(e.target.value)} className="w-40" />}
          </Field>
          <Field label={`Valore${kpi.unit ? ` (${kpi.unit})` : ""}`} error={errors.value}>
            {({ id }) => <Input id={id} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} className="w-32" />}
          </Field>
          <Button type="submit" size="sm" className="min-h-11 sm:min-h-7" variant="outline" disabled={pending || !value.trim()}>
            {T.save}
          </Button>
        </form>
      ) : null}
      <form
        className="grid gap-2 sm:grid-cols-3"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => updateKpiTargetsAction(workspaceId, kpi.id, texts), undefined, "Salvato.");
        }}
      >
        <Field label="Base" error={errors.base}>
          {({ id }) => <Input id={id} inputMode="decimal" value={texts.base} onChange={set("base")} />}
        </Field>
        <Field label="Obiettivo" error={errors.target}>
          {({ id }) => <Input id={id} inputMode="decimal" value={texts.target} onChange={set("target")} />}
        </Field>
        <Field label="Risultato chiave">
          {({ id }) => (
            <select id={id} className={SELECT_CLASS} value={texts.keyResultId} onChange={set("keyResultId")}>
              <option value="">Nessuno</option>
              {keyResults.map((kr) => (
                <option key={kr.id} value={kr.id}>
                  {kr.title}
                </option>
              ))}
            </select>
          )}
        </Field>
        <div className="flex gap-1.5 sm:col-span-3">
          <Button type="submit" size="sm" className="min-h-11 sm:min-h-7" variant="outline" disabled={pending}>
            {T.save}
          </Button>
          <Button type="button" size="sm" className="min-h-11 sm:min-h-7" variant="ghost" disabled={pending} onClick={() => run(() => removeKpiAction(workspaceId, kpi.id), undefined, `${kpi.label}: tolto.`)}>
            Togli il KPI
          </Button>
        </div>
      </form>
    </div>
  );
}

// ─── Risultati chiave ────────────────────────────────────────────────

/** La base, un aggiornamento e gli use case collegati di un risultato chiave. */
export function KeyResultEditor({ workspaceId, kr, today, cards }: { workspaceId: string; kr: ViewKeyResult; today: string; cards: ReadonlyArray<{ id: string; code: string | null; title: string }> }) {
  const [base, setBase] = useState(kr.base !== null ? String(kr.base).replace(".", ",") : "");
  const [value, setValue] = useState("");
  const [on, setOn] = useState(today);
  const [note, setNote] = useState("");
  const [link, setLink] = useState("");
  const { pending, errors, run } = useSave();
  const linked = new Set(kr.useCases.map((u) => u.id));
  return (
    <div className="space-y-3" data-slot="kr-editor">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => addKeyResultCheckinAction(workspaceId, kr.id, value, on, note), () => { setValue(""); setNote(""); }, "Aggiornamento salvato.");
        }}
      >
        <Field label="Valore di adesso" error={errors.value}>
          {({ id }) => <Input id={id} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} className="w-32" />}
        </Field>
        <Field label="Al giorno" error={errors.on}>
          {({ id }) => <Input id={id} type="date" value={on} onChange={(e) => setOn(e.target.value)} className="w-40" />}
        </Field>
        <Field label="Nota (facoltativa)" error={errors.note}>
          {({ id }) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} className="w-56" />}
        </Field>
        <Button type="submit" size="sm" className="min-h-11 sm:min-h-7" variant="outline" disabled={pending || !value.trim()}>
          Aggiorna
        </Button>
      </form>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => setKeyResultBaseAction(workspaceId, kr.id, base, today), undefined, "Base salvata.");
        }}
      >
        <Field label="Base" error={errors.base}>
          {({ id }) => <Input id={id} inputMode="decimal" value={base} onChange={(e) => setBase(e.target.value)} className="w-32" />}
        </Field>
        <Button type="submit" size="sm" className="min-h-11 sm:min-h-7" variant="ghost" disabled={pending || !base.trim()}>
          Salva la base
        </Button>
      </form>
      <div className="space-y-1.5">
        <p className="text-xs font-medium">Use case che ci contribuiscono</p>
        {kr.useCases.length ? (
          <ul className="flex flex-wrap gap-1.5">
            {kr.useCases.map((u) => (
              <li key={u.id} className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs">
                {u.code ?? u.title}
                <button type="button" className="-my-2 inline-flex min-h-11 min-w-8 items-center justify-center text-muted-foreground hover:text-foreground sm:min-h-0" aria-label={`Scollega ${u.code ?? u.title}`} disabled={pending} onClick={() => run(() => linkUseCaseToKeyResultAction(workspaceId, kr.id, u.id, false))}>
                  ✕
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="flex gap-1.5">
          <label htmlFor={`link-${kr.id}`} className="sr-only">
            Collega uno use case
          </label>
          <select id={`link-${kr.id}`} className={cn(SELECT_CLASS, "max-w-72")} value={link} onChange={(e) => setLink(e.target.value)}>
            <option value="">Collega uno use case…</option>
            {cards.filter((c) => !linked.has(c.id)).map((c) => (
              <option key={c.id} value={c.id}>
                {c.code ? `${c.code} · ${c.title}` : c.title}
              </option>
            ))}
          </select>
          <Button type="button" size="sm" className="min-h-11 sm:min-h-7" variant="outline" disabled={pending || !link} onClick={() => run(() => linkUseCaseToKeyResultAction(workspaceId, kr.id, link, true), () => setLink(""))}>
            Collega
          </Button>
        </div>
      </div>
      {kr.checkins.length ? (
        <p className="text-xs text-muted-foreground">
          Ultimo aggiornamento: {longDate(kr.checkins[kr.checkins.length - 1].on)}
        </p>
      ) : null}
    </div>
  );
}

/** «12.400 €» per le cifre dei moduli. */
export const euro = formatEuro;
