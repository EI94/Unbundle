"use client";

import {
  useActionState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  saveAiReadinessSurveyDraftAction,
  submitAiReadinessResponseAction,
  type AiReadinessActionState,
} from "@/lib/actions/ai-readiness";
import {
  USE_CASE_DRAFT_FIELDS,
  type AiReadinessDraftPayload,
} from "@/lib/ai-readiness/draft";
import type {
  AiReadinessQuestion,
  AiReadinessTemplateDefinition,
} from "@/lib/ai-readiness/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";

const INITIAL: AiReadinessActionState<{ completed: true }> = { ok: true };
const AUTOSAVE_DEBOUNCE_MS = 2000;

type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

function configString(config: Record<string, unknown> | null, key: string, fallback = "") {
  const value = config?.[key];
  return typeof value === "string" ? value : fallback;
}

function formatTime(iso: string | null) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("it-IT", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function QuestionField({
  question,
  error,
  defaultValue,
}: {
  question: AiReadinessQuestion;
  error?: string;
  defaultValue?: string;
}) {
  const name = `question__${question.id}`;
  if (question.answerType === "scale") {
    return (
      <div className="grid gap-3">
        <div className="grid grid-cols-6 gap-2">
          {[0, 1, 2, 3, 4, 5].map((value) => (
            <label
              key={value}
              className="flex cursor-pointer flex-col items-center gap-1 rounded-2xl border bg-background/70 p-2 text-sm hover:bg-muted has-checked:border-emerald-500 has-checked:bg-emerald-500/10"
            >
              <input
                required={question.required}
                type="radio"
                name={name}
                value={value}
                defaultChecked={defaultValue === String(value)}
              />
              <span className="font-semibold">{value}</span>
            </label>
          ))}
        </div>
        <div className="flex justify-between text-[11px] text-muted-foreground">
          <span>0 = non presente</span>
          <span>5 = AI native</span>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    );
  }
  if (question.answerType === "single_choice") {
    return (
      <div className="grid gap-2">
        {question.options?.map((option) => (
          <label
            key={option.value}
            className="flex cursor-pointer items-center gap-2 rounded-2xl border p-3 text-sm hover:bg-muted has-checked:border-emerald-500 has-checked:bg-emerald-500/10"
          >
            <input
              required={question.required}
              type="radio"
              name={name}
              value={option.value}
              defaultChecked={defaultValue === option.value}
            />
            <span>{option.label}</span>
          </label>
        ))}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <Textarea
        name={name}
        placeholder="Risposta libera opzionale"
        defaultValue={defaultValue}
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function collectDraftPayload(form: HTMLFormElement): AiReadinessDraftPayload {
  const formData = new FormData(form);
  const answers: Record<string, string> = {};
  for (const [key, rawValue] of formData.entries()) {
    if (!key.startsWith("question__") || typeof rawValue !== "string") continue;
    const value = rawValue.trim();
    if (value.length === 0) continue;
    answers[key.slice("question__".length)] = value;
  }
  const useCase: Record<string, string> = {};
  for (const field of USE_CASE_DRAFT_FIELDS) {
    const value = formData.get(field);
    if (typeof value === "string" && value.trim().length > 0) {
      useCase[field] = value.trim();
    }
  }
  return {
    answers,
    consents: {
      privacyAccepted: formData.get("privacyAccepted") === "on",
      benchmarkConsent: formData.get("benchmarkConsent") === "on",
      marketingConsent: formData.get("marketingConsent") === "on",
    },
    useCase,
  };
}

export function RespondentSurveyForm({
  token,
  template,
  brandConfig,
  privacyConfig,
  initialDraft,
  draftSavedAt,
}: {
  token: string;
  template: AiReadinessTemplateDefinition;
  brandConfig: Record<string, unknown> | null;
  privacyConfig: Record<string, unknown> | null;
  initialDraft?: AiReadinessDraftPayload | null;
  draftSavedAt?: string | null;
}) {
  const action = submitAiReadinessResponseAction.bind(null, token);
  const [state, formAction, pending] = useActionState(action, INITIAL);
  const completed = state.data?.completed === true;
  const sections = template.sections;

  const formRef = useRef<HTMLFormElement>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const completedRef = useRef(completed);
  completedRef.current = completed;

  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(
    draftSavedAt ?? null
  );

  const totalQuestions = useMemo(
    () =>
      template.questions.filter((question) => question.answerType !== "text")
        .length,
    [template.questions]
  );
  const countAnswered = useCallback(() => {
    const form = formRef.current;
    if (!form) return 0;
    const payload = collectDraftPayload(form);
    return template.questions.filter(
      (question) =>
        question.answerType !== "text" &&
        payload.answers[question.id] != null
    ).length;
  }, [template.questions]);
  const [answeredCount, setAnsweredCount] = useState(() =>
    initialDraft
      ? template.questions.filter(
          (question) =>
            question.answerType !== "text" &&
            initialDraft.answers[question.id] != null
        ).length
      : 0
  );

  const flushSave = useCallback(async () => {
    const form = formRef.current;
    if (!form || inFlightRef.current || pendingRef.current || completedRef.current) {
      return;
    }
    inFlightRef.current = true;
    setSaveStatus("saving");
    try {
      const result = await saveAiReadinessSurveyDraftAction(
        token,
        collectDraftPayload(form)
      );
      if (result.ok && result.data?.savedAt) {
        setLastSavedAt(result.data.savedAt);
        setSaveStatus("saved");
      } else {
        setSaveStatus("error");
      }
    } catch {
      setSaveStatus("error");
    } finally {
      inFlightRef.current = false;
    }
  }, [token]);

  const scheduleSave = useCallback(() => {
    setSaveStatus("dirty");
    setAnsweredCount(countAnswered());
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void flushSave();
    }, AUTOSAVE_DEBOUNCE_MS);
  }, [countAnswered, flushSave]);

  // Salvataggio "di emergenza" quando l'utente lascia la pagina a metà.
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden" && saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        void flushSave();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [flushSave]);

  if (completed) {
    return (
      <div className="rounded-[32px] border bg-card p-8 text-center">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600">
          OK
        </div>
        <h1 className="text-2xl font-semibold">Risposte inviate</h1>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
          {configString(
            brandConfig,
            "completionCopy",
            "Grazie. Le risposte saranno aggregate e usate per costruire una roadmap AI piu concreta e sicura."
          )}
        </p>
      </div>
    );
  }

  const progressPercent =
    totalQuestions > 0
      ? Math.round((answeredCount / totalQuestions) * 100)
      : 0;
  const savedTimeLabel = formatTime(lastSavedAt);
  const saveLabel =
    saveStatus === "saving"
      ? "Salvataggio in corso..."
      : saveStatus === "error"
        ? "Salvataggio non riuscito. Riprova tra poco: le risposte restano su questa pagina."
        : saveStatus === "dirty"
          ? "Modifiche non ancora salvate..."
          : savedTimeLabel
            ? `Bozza salvata alle ${savedTimeLabel}`
            : "Le risposte si salvano automaticamente: puoi riprendere quando vuoi.";

  return (
    <form
      ref={formRef}
      action={formAction}
      onChange={scheduleSave}
      className="space-y-8"
    >
      {initialDraft && (
        <div
          className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm leading-6"
          data-testid="survey-resume-banner"
        >
          <span className="font-semibold">Bentornato.</span> Abbiamo recuperato
          la bozza salvata{savedTimeLabel ? ` alle ${savedTimeLabel}` : ""}: puoi
          riprendere da dove avevi lasciato.
        </div>
      )}

      <div
        className="sticky top-2 z-10 rounded-2xl border bg-card/95 p-4 shadow-sm backdrop-blur"
        data-testid="survey-progress"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="font-medium">
            {answeredCount} / {totalQuestions} risposte
          </span>
          <span
            className={`text-xs ${
              saveStatus === "error"
                ? "text-destructive"
                : "text-muted-foreground"
            }`}
            role="status"
            data-testid="survey-save-status"
          >
            {saveLabel}
          </span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-emerald-500 transition-all"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      <section className="rounded-[32px] border bg-linear-to-br from-emerald-500/10 via-card to-sky-500/10 p-6">
        <div className="text-xs uppercase tracking-[0.22em] text-muted-foreground">
          Privacy by design
        </div>
        <h2 className="mt-3 text-xl font-semibold">Prima di iniziare</h2>
        <div className="mt-3 grid gap-2 text-sm leading-6 text-muted-foreground md:grid-cols-2">
          <p>
            Titolare: {configString(privacyConfig, "controllerName", "azienda cliente")}.
            Processore: {configString(privacyConfig, "processorName", "Unbundle / Lateral Space")}.
          </p>
          <p>
            Finalita: misurare la readiness AI in forma aggregata. Nessun manager
            vede risposte individuali salvo configurazione privacy esplicita.
          </p>
          <p>
            Base giuridica: {configString(privacyConfig, "legalBasis", "configurata dall'azienda")}.
            Retention: {String(privacyConfig?.dataRetentionDays ?? 365)} giorni.
          </p>
          <p>
            Supporto: {configString(privacyConfig, "supportEmail", "contatta il referente interno")}.
          </p>
        </div>
        {configString(privacyConfig, "privacyNoticeUrl") && (
          <a
            className="mt-3 inline-flex text-sm underline"
            href={configString(privacyConfig, "privacyNoticeUrl")}
            target="_blank"
            rel="noreferrer"
          >
            Leggi informativa privacy completa
          </a>
        )}
        <div className="mt-5 space-y-3">
          <label className="flex items-start gap-3 rounded-2xl border bg-background/60 p-3 text-sm">
            <Checkbox
              name="privacyAccepted"
              defaultChecked={initialDraft?.consents.privacyAccepted === true}
            />
            <span>Ho letto l&apos;informativa e accetto di partecipare all&apos;assessment.</span>
          </label>
          <label className="flex items-start gap-3 rounded-2xl border bg-background/60 p-3 text-sm">
            <Checkbox
              name="benchmarkConsent"
              defaultChecked={initialDraft?.consents.benchmarkConsent === true}
            />
            <span>Acconsento all&apos;uso aggregato e anonimo per benchmark futuri.</span>
          </label>
          <label className="flex items-start gap-3 rounded-2xl border bg-background/60 p-3 text-sm">
            <Checkbox
              name="marketingConsent"
              defaultChecked={initialDraft?.consents.marketingConsent === true}
            />
            <span>Acconsento a ricevere comunicazioni opzionali sul percorso AI.</span>
          </label>
          {state.fieldErrors?.privacyAccepted && (
            <p className="text-xs text-destructive">{state.fieldErrors.privacyAccepted}</p>
          )}
        </div>
      </section>

      {sections.map((section) => (
        <section key={section.id} className="rounded-[32px] border bg-card p-6">
          <div className="text-xs uppercase tracking-[0.22em] text-muted-foreground">
            {template.pillars.find((pillar) => pillar.id === section.pillarId)?.title}
          </div>
          <h2 className="mt-2 text-xl font-semibold">{section.title}</h2>
          {section.description && (
            <p className="mt-2 text-sm text-muted-foreground">{section.description}</p>
          )}
          <div className="mt-6 space-y-7">
            {template.questions
              .filter((question) => question.sectionId === section.id)
              .map((question) => (
                <div key={question.id} className="space-y-3">
                  <Label className="text-base leading-6">
                    {question.label}
                    {question.required ? <span className="text-destructive"> *</span> : null}
                  </Label>
                  {question.description && (
                    <p className="text-sm text-muted-foreground">{question.description}</p>
                  )}
                  <QuestionField
                    question={question}
                    error={state.fieldErrors?.[`question__${question.id}`]}
                    defaultValue={initialDraft?.answers[question.id]}
                  />
                </div>
              ))}
          </div>
        </section>
      ))}

      <section className="rounded-[32px] border bg-card p-6">
        <div className="text-xs uppercase tracking-[0.22em] text-muted-foreground">
          Use case intake opzionale
        </div>
        <h2 className="mt-2 text-xl font-semibold">Hai un caso concreto da proporre?</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Se vuoi, segnala un processo che potrebbe essere migliorato con AI. Non serve essere
          tecnici: basta descrivere problema, output desiderato e controllo umano.
        </p>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <Input
            name="useCaseTitle"
            placeholder="Titolo use case"
            defaultValue={initialDraft?.useCase.useCaseTitle}
          />
          <Input
            name="useCaseFrequency"
            placeholder="Frequenza del processo"
            defaultValue={initialDraft?.useCase.useCaseFrequency}
          />
          <Textarea
            name="useCaseCurrentProcess"
            placeholder="Processo attuale"
            defaultValue={initialDraft?.useCase.useCaseCurrentProcess}
          />
          <Textarea
            name="useCasePainPoint"
            placeholder="Pain point"
            defaultValue={initialDraft?.useCase.useCasePainPoint}
          />
          <Textarea
            name="useCaseDesiredOutcome"
            placeholder="Outcome desiderato"
            defaultValue={initialDraft?.useCase.useCaseDesiredOutcome}
          />
          <Textarea
            name="useCaseAiHypothesis"
            placeholder="Ipotesi soluzione AI"
            defaultValue={initialDraft?.useCase.useCaseAiHypothesis}
          />
          <Input
            name="useCaseBeneficiaries"
            type="number"
            min={0}
            placeholder="Beneficiari stimati"
            defaultValue={initialDraft?.useCase.useCaseBeneficiaries}
          />
          <Input
            name="useCaseRiskLevel"
            placeholder="Rischio: basso, medio, alto"
            defaultValue={initialDraft?.useCase.useCaseRiskLevel}
          />
          <Textarea
            name="useCaseDataNeeded"
            placeholder="Dati necessari"
            defaultValue={initialDraft?.useCase.useCaseDataNeeded}
          />
          <Textarea
            name="useCaseHumanInLoop"
            placeholder="Controllo umano necessario"
            defaultValue={initialDraft?.useCase.useCaseHumanInLoop}
          />
          <Textarea
            name="useCaseRiskReasoning"
            placeholder="Perche potrebbe essere rischioso?"
            defaultValue={initialDraft?.useCase.useCaseRiskReasoning}
          />
          <Textarea
            name="useCaseImpactEstimate"
            placeholder="Impatto atteso"
            defaultValue={initialDraft?.useCase.useCaseImpactEstimate}
          />
          <Input
            name="useCaseToolsUsed"
            placeholder="Tool attuali"
            defaultValue={initialDraft?.useCase.useCaseToolsUsed}
          />
        </div>
      </section>

      {state.message && !completed && (
        <p className={`text-sm ${state.ok ? "text-emerald-600" : "text-destructive"}`}>
          {state.message}
        </p>
      )}
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Invio risposte..." : "Invia assessment"}
      </Button>
    </form>
  );
}
