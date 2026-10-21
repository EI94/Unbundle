"use client";

import {
  useActionState,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  recalibratePortfolioScoresAction,
  updateScoringModelAction,
  type ActionState,
} from "@/lib/actions/portfolio";
import { saveValuationModelAction } from "@/lib/actions/use-case-settings";
import { VALUATION_SETTINGS_TEXT, midImpactAboveHighError } from "@/lib/use-cases/settings";
import type {
  ScoringKpi,
  ScoringModelConfig,
} from "@/lib/db/queries/scoring-model";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";

const INITIAL: ActionState = { ok: true };

type Dim = "impact" | "feasibility" | "esg";
const dimLabels: Record<Dim, string> = {
  impact: "Impatto",
  feasibility: "Fattibilità",
  esg: "ESG",
};

const ESG_HELP = "Impatto ambientale e sociale, quando ESG è attivo nel workspace.";

const MODEL_TEXT = VALUATION_SETTINGS_TEXT.model;

/** I testi del modulo che cambiano con il posto: aiuti, anteprima, conferma, salvataggio. */
type FormCopy = {
  valueHelp: string;
  feasibilityHelp: string;
  /** La riga sopra il titolo dell'anteprima; null: niente riga. */
  previewEyebrow: string | null;
  previewTitle: string;
  previewNote: string;
  direction: string;
  confirm: string;
  /** Sotto l'esito del salvataggio: l'invito a ricalibrare. */
  savedHint: string;
};

/** Il pannello di oggi, fuori dall'area: i suoi testi restano com'erano. */
const PANEL_COPY: FormCopy = {
  valueHelp: "I criteri che definiscono il valore generato dal contributo.",
  feasibilityHelp: "Quanto è semplice o complesso portare il contributo in produzione.",
  previewEyebrow: "Scorecard attiva",
  previewTitle: "KPI usati per il ranking",
  previewNote:
    "Questi sono i parametri visibili nella pagina Use case: se li modifichi e salvi, puoi ricalibrare automaticamente tutti i contributi.",
  direction: "Direzione ranking",
  confirm:
    "Salvare il modello di ranking? La modifica vale per tutto il team: i pesi e le soglie aggiornati cambieranno il punteggio e la zona di tutti gli use case del workspace.",
  savedHint: "Modello salvato. Se hai cambiato KPI o rubriche, ora puoi ricalibrare i contributi con AI.",
};

/** Impostazioni › Valutazione, dentro l'area: le parole del glossario (§14.1). */
const SETTINGS_COPY: FormCopy = {
  valueHelp: MODEL_TEXT.valueHelp,
  feasibilityHelp: MODEL_TEXT.feasibilityHelp,
  previewEyebrow: null,
  previewTitle: MODEL_TEXT.previewTitle,
  previewNote: MODEL_TEXT.previewNote,
  direction: MODEL_TEXT.direction,
  confirm: MODEL_TEXT.confirm,
  savedHint: MODEL_TEXT.savedHint,
};

/**
 * ESG si accende solo in Impostazioni › Valutazione, nella sezione «Criteri ESG» (DESIGN §13):
 * i testi del modulo mandano lì, con o senza la sezione nella stessa pagina.
 */
const ESG_SECTION = "«Criteri ESG»";
const ESG_TEXT = {
  off: (inSettings: boolean) =>
    `ESG è spento per questo workspace. Lo accendi in ${
      inSettings ? `${ESG_SECTION}, in questa pagina` : `Impostazioni › Valutazione, ${ESG_SECTION}`
    }: da lì la dimensione entra nella valutazione e ne modifichi i KPI qui.`,
  previewOff: `Si accende in ${ESG_SECTION}.`,
  previewEmpty: `ESG è spento: accendilo in ${ESG_SECTION} per vedere anche i KPI ambientali e sociali.`,
};

function genId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().slice(0, 8);
  }
  return Math.random().toString(36).slice(2, 10);
}

function cloneKpis(kpis: ScoringKpi[]) {
  return kpis.map((k) => ({ ...k }));
}

export function ScoringModelForm({
  workspaceId,
  initialConfig,
  esgEnabled,
  inSettings,
}: {
  workspaceId: string;
  initialConfig: ScoringModelConfig;
  esgEnabled: boolean;
  /**
   * Il modulo dentro Impostazioni › Valutazione, dove «Valore alto da» e le zone che decide
   * stanno già nelle «Soglie» della sezione. Qui: niente «Valore alto da» né «Fattibilità alta
   * da» (decide solo `category`, che non si mostra più, §7.4); il modulo manda solo «Valore
   * medio da» e `saveValuationModelAction` aggiunge le due soglie salvate, rilette al
   * salvataggio. La dimensione d'impatto si chiama «Valore» (§14.1), il blocco delle soglie
   * «Valore medio», e «Salva modello» è bordato (la pagina ha già il suo pulsante pieno). Gli
   * altri testi sono quelli dell'area (`SETTINGS_COPY`): «use case», non «contributo»; niente
   * «ranking» né «Scorecard». Senza, il modulo del pannello di oggi, con i suoi testi.
   */
  inSettings?: boolean;
}) {
  const boundAction = (inSettings ? saveValuationModelAction : updateScoringModelAction).bind(null, workspaceId);
  const [state, formAction, pending] = useActionState(boundAction, INITIAL);
  const fe = state.fieldErrors ?? {};
  const [recalibrateState, setRecalibrateState] = useState<ActionState<{ updated: number; failed: number; total: number }> | null>(null);
  const [recalibrating, startRecalibration] = useTransition();
  const router = useRouter();

  const [impact, setImpact] = useState<ScoringKpi[]>(() =>
    cloneKpis(initialConfig.dimensions.impact)
  );
  const [feasibility, setFeasibility] = useState<ScoringKpi[]>(() =>
    cloneKpis(initialConfig.dimensions.feasibility)
  );
  const [esg, setEsg] = useState<ScoringKpi[]>(() =>
    cloneKpis(initialConfig.dimensions.esg)
  );
  const [overall, setOverall] = useState(initialConfig.overall);
  const [thresholds, setThresholds] = useState(initialConfig.thresholds);

  const setters: Record<Dim, Dispatch<SetStateAction<ScoringKpi[]>>> = {
    impact: setImpact,
    feasibility: setFeasibility,
    esg: setEsg,
  };
  const payload = useMemo(() => {
    return JSON.stringify({
      dimensions: { impact, feasibility, esg },
      overall,
      thresholds,
    });
  }, [impact, feasibility, esg, overall, thresholds]);
  // Quello che parte salvando. In Impostazioni partono solo KPI, pesi e «Valore medio da»:
  // «Valore alto da» e «Fattibilità alta da» li aggiunge l'action, quelli salvati in quel
  // momento, così una pagina vecchia non riporta indietro le «Soglie» della sezione.
  const settingsPlacement = Boolean(inSettings);
  const sentPayload = useMemo(() => {
    if (!settingsPlacement) return payload;
    return JSON.stringify({
      dimensions: { impact, feasibility, esg },
      overall,
      thresholds: { midImpact: thresholds.midImpact },
    });
  }, [settingsPlacement, payload, impact, feasibility, esg, overall, thresholds.midImpact]);
  // «Valore medio da» non sopra «Valore alto da» salvato (arriva nuovo con la pagina quando le
  // «Soglie» lo cambiano): l'errore in italiano subito, senza partire. L'action rifà il
  // controllo con il valore salvato in quel momento.
  const savedHighImpact = initialConfig.thresholds.highImpact;
  const midAboveHigh = settingsPlacement && thresholds.midImpact > savedHighImpact;
  const midImpactError = midAboveHigh
    ? midImpactAboveHighError(savedHighImpact)
    : fe["thresholds.midImpact"];
  const advancedRef = useRef<HTMLDetailsElement>(null);
  const impactLabel = settingsPlacement ? MODEL_TEXT.valueDimension : dimLabels.impact;
  const copy = settingsPlacement ? SETTINGS_COPY : PANEL_COPY;
  const [savedPayload, setSavedPayload] = useState(payload);
  const submittedPayloadRef = useRef(payload);
  const hasUnsavedChanges = payload !== savedPayload;

  // Ogni esito nuovo dell'action è un oggetto nuovo: un salvataggio riuscito (`ok`, mai lo
  // stato iniziale) segna il modello salvato, anche quando il messaggio è lo stesso di prima.
  // Le due action hanno testi diversi: non si confronta il messaggio.
  useEffect(() => {
    if (state === INITIAL || !state.ok) return;
    setSavedPayload(submittedPayloadRef.current);
    setRecalibrateState({ ok: true, message: copy.savedHint, fieldErrors: {} });
    router.refresh();
  }, [router, state, copy.savedHint]);

  const addKpi = (dim: Dim) =>
    setters[dim]((prev) => [
      ...prev,
      {
        id: genId(),
        label: "",
        description: "",
        weight: 1,
        direction: "higher_better",
      },
    ]);

  const removeKpi = (dim: Dim, idx: number) =>
    setters[dim]((prev) => prev.filter((_, i) => i !== idx));

  const patchKpi = (dim: Dim, idx: number, patch: Partial<ScoringKpi>) =>
    setters[dim]((prev) => {
      const next = prev.slice();
      next[idx] = { ...next[idx], ...patch };
      return next;
    });

  const handleRecalibration = () => {
    if (hasUnsavedChanges) {
      setRecalibrateState({
        ok: false,
        message:
          "Salva il modello prima di ricalibrare: così l'AI userà KPI, pesi e rubriche aggiornati.",
        fieldErrors: {},
      });
      return;
    }
    startRecalibration(async () => {
      const result = await recalibratePortfolioScoresAction(workspaceId);
      setRecalibrateState(result);
      if (result.ok) {
        router.refresh();
      }
    });
  };

  return (
    <form
      action={formAction}
      className="space-y-6"
      onSubmit={(event) => {
        if (midAboveHigh) {
          event.preventDefault();
          if (advancedRef.current) advancedRef.current.open = true;
          return;
        }
        if (!window.confirm(copy.confirm)) {
          event.preventDefault();
          return;
        }
        submittedPayloadRef.current = payload;
      }}
    >
      <input type="hidden" name="payload" value={sentPayload} />

      {state.message && (
        <div
          className={`rounded-md border p-3 text-sm ${
            state.ok
              ? "border-green-500/30 bg-green-500/5 text-green-500"
              : "border-red-500/30 bg-red-500/5 text-red-500"
          }`}
          role="status"
        >
          {state.message}
        </div>
      )}

      {recalibrateState?.message && (
        <div
          className={`rounded-md border p-3 text-sm ${
            recalibrateState.ok
              ? "border-green-500/30 bg-green-500/5 text-green-500"
              : "border-red-500/30 bg-red-500/5 text-red-500"
          }`}
          role="status"
        >
          {recalibrateState.message}
        </div>
      )}

      <ScorecardPreview
        impact={impact}
        feasibility={feasibility}
        esg={esg}
        esgEnabled={esgEnabled}
        impactLabel={impactLabel}
        copy={copy}
      />

      <Dimension
        dim="impact"
        title={impactLabel}
        help={copy.valueHelp}
        directionLabel={copy.direction}
        kpis={impact}
        onAdd={() => addKpi("impact")}
        onRemove={(i) => removeKpi("impact", i)}
        onPatch={(i, p) => patchKpi("impact", i, p)}
        fieldErrors={fe}
      />

      <Dimension
        dim="feasibility"
        title={dimLabels.feasibility}
        help={copy.feasibilityHelp}
        directionLabel={copy.direction}
        kpis={feasibility}
        onAdd={() => addKpi("feasibility")}
        onRemove={(i) => removeKpi("feasibility", i)}
        onPatch={(i, p) => patchKpi("feasibility", i, p)}
        fieldErrors={fe}
      />

      {esgEnabled ? (
        <Dimension
          dim="esg"
          title={dimLabels.esg}
          help={ESG_HELP}
          directionLabel={copy.direction}
          kpis={esg}
          onAdd={() => addKpi("esg")}
          onRemove={(i) => removeKpi("esg", i)}
          onPatch={(i, p) => patchKpi("esg", i, p)}
          fieldErrors={fe}
        />
      ) : (
        <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          {ESG_TEXT.off(settingsPlacement)}
        </div>
      )}

      <details ref={advancedRef} className="rounded-2xl border p-4">
        <summary className="cursor-pointer list-none text-sm font-semibold outline-none marker:hidden">
          Impostazioni avanzate
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            {inSettings ? MODEL_TEXT.advancedHint : "pesi globali e soglie matrice"}
          </span>
        </summary>
        <div className="mt-4 space-y-5">
          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Pesi globali</h3>
            <p className="text-xs text-muted-foreground">
              Servono solo se vuoi dare più importanza a una dimensione rispetto
              alle altre. Se non sei sicuro, lascia i valori standard.
            </p>
            {fe["overall"] && (
              <p className="text-xs text-red-500">{fe["overall"]}</p>
            )}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <LabeledNumber
                label={impactLabel}
                value={overall.impact}
                onChange={(v) => setOverall((o) => ({ ...o, impact: v }))}
                error={fe["overall.impact"]}
              />
              <LabeledNumber
                label="Fattibilità"
                value={overall.feasibility}
                onChange={(v) => setOverall((o) => ({ ...o, feasibility: v }))}
                error={fe["overall.feasibility"]}
              />
              <LabeledNumber
                label="ESG"
                value={overall.esg}
                disabled={!esgEnabled}
                onChange={(v) => setOverall((o) => ({ ...o, esg: v }))}
                error={fe["overall.esg"]}
              />
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">
              {inSettings ? MODEL_TEXT.midImpactTitle : "Soglie della matrice (0-5)"}
            </h3>
            <p className="text-xs text-muted-foreground">
              {inSettings
                ? MODEL_TEXT.midImpactHelp
                : "Determinano le zone: Subito, Da pianificare, Se avanza tempo, Non ora."}
            </p>
            <div
              className={`grid grid-cols-1 gap-3 ${inSettings ? "md:grid-cols-2" : "md:grid-cols-3"}`}
            >
              {!inSettings && (
                <>
                  <LabeledNumber
                    label="Valore alto da"
                    value={thresholds.highImpact}
                    onChange={(v) =>
                      setThresholds((t) => ({ ...t, highImpact: v }))
                    }
                    error={fe["thresholds.highImpact"]}
                    step={0.1}
                    min={0}
                    max={5}
                  />
                  <LabeledNumber
                    label="Fattibilità alta da"
                    value={thresholds.highFeasibility}
                    onChange={(v) =>
                      setThresholds((t) => ({ ...t, highFeasibility: v }))
                    }
                    error={fe["thresholds.highFeasibility"]}
                    step={0.1}
                    min={0}
                    max={5}
                  />
                </>
              )}
              <LabeledNumber
                label="Valore medio da"
                value={thresholds.midImpact}
                onChange={(v) => setThresholds((t) => ({ ...t, midImpact: v }))}
                error={midImpactError}
                step={0.1}
                min={0}
                max={5}
              />
            </div>
          </section>
        </div>
      </details>

      <div className="flex items-center justify-end">
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={handleRecalibration}
            disabled={recalibrating || hasUnsavedChanges}
          >
            {hasUnsavedChanges
              ? "Salva prima di ricalibrare"
              : recalibrating
                ? "Ricalibrazione…"
                : "Ricalibra tutti con AI"}
          </Button>
          <Button
            type="submit"
            variant={inSettings ? "outline" : "default"}
            disabled={pending}
          >
            {pending ? "Salvataggio…" : "Salva modello"}
          </Button>
        </div>
      </div>
    </form>
  );
}

function ScorecardPreview({
  impact,
  feasibility,
  esg,
  esgEnabled,
  impactLabel,
  copy,
}: {
  impact: ScoringKpi[];
  feasibility: ScoringKpi[];
  esg: ScoringKpi[];
  esgEnabled: boolean;
  impactLabel: string;
  copy: FormCopy;
}) {
  const rows = [
    {
      title: impactLabel,
      description: "Valore creato.",
      kpis: impact,
    },
    {
      title: "Fattibilità",
      description: "Sforzo richiesto.",
      kpis: feasibility,
    },
    {
      title: "Sostenibilità",
      description: esgEnabled ? "Ambiente e persone." : ESG_TEXT.previewOff,
      kpis: esgEnabled ? esg : [],
    },
  ];

  return (
    <section className="rounded-2xl border bg-muted/20 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          {copy.previewEyebrow && (
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {copy.previewEyebrow}
            </p>
          )}
          <h3 className="text-base font-semibold">{copy.previewTitle}</h3>
        </div>
        <div className="rounded-full border px-3 py-1 text-[11px] font-medium text-muted-foreground">
          Scala 1-5
        </div>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{copy.previewNote}</p>

      <div className="mt-4 space-y-3">
        {rows.map((row) => (
          <div
            key={row.title}
            className="rounded-xl border bg-background/70 p-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              <div className="min-w-24 text-sm font-semibold">{row.title}</div>
              <span className="text-[11px] text-muted-foreground">
                {row.description}
              </span>
            </div>
            {row.kpis.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {row.kpis.map((kpi) => (
                  <span
                    key={kpi.id}
                    className="rounded-full border bg-background/80 px-2 py-1 text-[11px] font-medium"
                    title={kpi.description}
                  >
                    {kpi.label}
                    {kpi.direction === "lower_better" ? " (basso = meglio)" : ""}
                  </span>
                ))}
              </div>
            ) : (
              <p className="mt-3 rounded-lg border border-dashed p-2 text-[11px] text-muted-foreground">
                {ESG_TEXT.previewEmpty}
              </p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function Dimension({
  dim,
  title,
  help,
  directionLabel,
  kpis,
  onAdd,
  onRemove,
  onPatch,
  fieldErrors,
}: {
  dim: Dim;
  title: string;
  help: string;
  directionLabel: string;
  kpis: ScoringKpi[];
  onAdd: () => void;
  onRemove: (i: number) => void;
  onPatch: (i: number, patch: Partial<ScoringKpi>) => void;
  fieldErrors: Record<string, string>;
}) {
  const dimError = fieldErrors[`dimensions.${dim}`];
  return (
    <section className="space-y-3 rounded-2xl border p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="text-xs text-muted-foreground">{help}</p>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={onAdd}>
          <Plus className="mr-1 h-3.5 w-3.5" /> Nuovo KPI
        </Button>
      </div>
      {dimError && <p className="text-xs text-red-500">{dimError}</p>}
      {kpis.length === 0 && (
        <p className="text-xs text-muted-foreground italic">
          Nessun KPI definito. Aggiungine almeno uno.
        </p>
      )}
      <ul className="space-y-3">
        {kpis.map((k, i) => {
          const labelErr = fieldErrors[`dimensions.${dim}.${i}.label`];
          const weightErr = fieldErrors[`dimensions.${dim}.${i}.weight`];
          return (
            <li key={k.id} className="space-y-3 rounded-xl border bg-muted/15 p-3">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_180px_auto] md:items-end">
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-muted-foreground">
                    KPI
                  </label>
                  <Input
                    className="h-9"
                    placeholder="Nome KPI"
                    value={k.label}
                    onChange={(e) => onPatch(i, { label: e.target.value })}
                    aria-invalid={!!labelErr}
                  />
                  {labelErr && (
                    <p className="text-xs text-red-500">{labelErr}</p>
                  )}
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-muted-foreground">
                    {directionLabel}
                  </label>
                  <select
                    value={k.direction ?? "higher_better"}
                    onChange={(e) =>
                      onPatch(i, {
                        direction:
                          e.target.value === "lower_better"
                            ? "lower_better"
                            : "higher_better",
                      })
                    }
                    className="h-9 w-full rounded-lg border border-input bg-background px-2.5 py-1 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    <option value="higher_better">Più alto = meglio</option>
                    <option value="lower_better">Più basso = meglio</option>
                  </select>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="justify-self-start md:justify-self-end"
                  onClick={() => onRemove(i)}
                  aria-label="Rimuovi KPI"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <Textarea
                placeholder="Rubrica: cosa distingue 1 da 5?"
                value={k.description ?? ""}
                onChange={(e) => onPatch(i, { description: e.target.value })}
                rows={3}
              />
              <details className="rounded-lg border bg-background/60 px-3 py-2">
                <summary className="cursor-pointer list-none text-xs font-medium text-muted-foreground outline-none marker:hidden">
                  Avanzate: peso relativo{" "}
                  <span className="tabular-nums">
                    {Number.isFinite(k.weight) ? k.weight : 1}
                  </span>
                </summary>
                <div className="mt-3 space-y-2">
                  <p className="text-xs text-muted-foreground">
                    Il peso decide quanto questo KPI conta rispetto agli altri
                    nella stessa sezione. 1 è standard; 2 conta il doppio. Se
                    non ti serve, lascialo a 1.
                  </p>
                  <LabeledNumber
                    label="Peso relativo"
                    value={Number.isFinite(k.weight) ? k.weight : 1}
                    onChange={(value) => onPatch(i, { weight: value })}
                    error={weightErr}
                    step={0.1}
                    min={0}
                  />
                </div>
              </details>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function LabeledNumber({
  label,
  value,
  onChange,
  disabled,
  error,
  step = 0.05,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  disabled?: boolean;
  error?: string;
  step?: number;
  min?: number;
  max?: number;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-muted-foreground">{label}</label>
      <Input
        type="number"
        step={step}
        min={min}
        max={max}
        value={Number.isFinite(value) ? value : 0}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value.replace(",", ".")))}
        aria-invalid={!!error}
      />
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
