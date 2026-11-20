"use client";

import {
  startTransition,
  useActionState,
  useCallback,
  useEffect,
  useLayoutEffect,
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
  type AiReadinessDraftIdentity,
  type AiReadinessDraftPayload,
} from "@/lib/ai-readiness/draft";
import { AI_READINESS_DEFAULT_COPY, brandCopy } from "@/lib/ai-readiness/copy";
import { validateSurveyPayload } from "@/lib/ai-readiness/form-validation";
import type {
  AiReadinessQuestion,
  AiReadinessTemplateDefinition,
} from "@/lib/ai-readiness/types";
import { SURVEY_TEXT, surveyProgressLabel, type SurveySaveStatus } from "@/lib/public/survey";
import { PUBLIC_TEXT } from "@/lib/public/text";
import { cn } from "@/lib/utils";
import { PUBLIC_FIELD, PUBLIC_LABEL, PUBLIC_LINK, PUBLIC_PRIMARY } from "@/components/public/classes";
import { Fold } from "@/components/ui-10/fold";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";

/**
 * Il questionario del link personale (`/a/<token>`): il questionario per tutti e la scheda dei referenti.
 *
 * (Rilascio 10, ondata 4, docs/ui-10/PROPOSTA-10.md §3.11, audit Fuori §3.8) Una barra in alto con un solo numero e lo
 * stato del salvataggio («7 di 19 · salvato 10:42»); niente casella dell'informativa: la presa visione si registra
 * all'invio, con una riga e il link a «Come usiamo le tue risposte» (`privacyAccepted` viaggia con il pulsante
 * «Invia le risposte», mai nella bozza); confronto e comunicazioni solo quando la rilevazione li chiede, come prima.
 * Le aree senza occhielli e senza nomi inglesi, ogni domanda in un `fieldset` con la sua `legend`; il modulo dei casi
 * d'uso, facoltativo e chiuso, per il questionario per tutti e mai per i referenti. Testi a 16 px, bersagli di 44 px,
 * «Invia le risposte» a tutta larghezza e alto 48 px. I testi stanno in `src/lib/public/survey.ts`.
 *
 * Il salvataggio resta quello di prima: subito sul dispositivo, sul server dopo 2 secondi e quando si lascia la pagina;
 * la bozza del dispositivo più recente di quella del server torna nel modulo.
 */

const INITIAL: AiReadinessActionState<{ completed: true }> = { ok: true };
const AUTOSAVE_DEBOUNCE_MS = 2000;

const F = SURVEY_TEXT.form;
const U = SURVEY_TEXT.useCase;

type DeviceDraft = {
  v: 1;
  savedAt: string;
  payload: AiReadinessDraftPayload;
};

function deviceStorageKey(token: string) {
  return `unbundle-air-draft:${token}`;
}

function readDeviceDraft(token: string): DeviceDraft | null {
  try {
    const raw = window.localStorage.getItem(deviceStorageKey(token));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DeviceDraft;
    if (parsed?.v !== 1 || !parsed.payload) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeDeviceDraft(token: string, payload: AiReadinessDraftPayload) {
  try {
    const entry: DeviceDraft = {
      v: 1,
      savedAt: new Date().toISOString(),
      payload,
    };
    window.localStorage.setItem(deviceStorageKey(token), JSON.stringify(entry));
  } catch {
    // Storage pieno o bloccato: il salvataggio server resta la rete di sicurezza.
  }
}

function clearDeviceDraft(token: string) {
  try {
    window.localStorage.removeItem(deviceStorageKey(token));
  } catch {
    // ignore
  }
}

/** Applica al form (non controllato) i valori di una bozza salvata sul dispositivo. */
function applyPayloadToForm(form: HTMLFormElement, payload: AiReadinessDraftPayload) {
  for (const [questionId, value] of Object.entries(payload.answers ?? {})) {
    const name = `question__${questionId}`;
    const radio = form.querySelector<HTMLInputElement>(
      `input[type=radio][name="${CSS.escape(name)}"][value="${CSS.escape(value)}"]`
    );
    if (radio) {
      radio.checked = true;
      continue;
    }
    const field = form.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      `textarea[name="${CSS.escape(name)}"], input[name="${CSS.escape(name)}"]`
    );
    if (field) field.value = value;
  }
  for (const field of USE_CASE_DRAFT_FIELDS) {
    const value = payload.useCase?.[field];
    if (typeof value !== "string") continue;
    const el = form.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      `input[name="${field}"], textarea[name="${field}"]`
    );
    if (el) el.value = value;
  }
  if (payload.identity) {
    const first = form.querySelector<HTMLInputElement>('input[name="respondentFirstName"]');
    const last = form.querySelector<HTMLInputElement>('input[name="respondentLastName"]');
    if (first && payload.identity.firstName) first.value = payload.identity.firstName;
    if (last && payload.identity.lastName) last.value = payload.identity.lastName;
  }
  // Solo i consensi facoltativi: la presa visione dell'informativa non è nel modulo, viaggia con il pulsante d'invio.
  const consentEntries: Array<[string, boolean]> = [
    ["benchmarkConsent", payload.consents?.benchmarkConsent === true],
    ["marketingConsent", payload.consents?.marketingConsent === true],
  ];
  for (const [name, desired] of consentEntries) {
    const input = form.querySelector<HTMLInputElement>(`input[name="${name}"]`);
    if (!input || input.checked === desired || !desired) continue;
    // Base UI checkbox: il click sul controllo visivo aggiorna stato + input nascosto.
    const visual = input
      .closest("label")
      ?.querySelector<HTMLElement>("[data-slot=checkbox]");
    if (visual) visual.click();
  }
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

/** Una scelta del questionario: tutta la riga si tocca, almeno 44 px. */
const CHOICE =
  "flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-border p-3 hover:bg-muted has-checked:border-primary has-checked:bg-primary/10";

function QuestionField({
  question,
  error,
  errorId,
  legendId,
  defaultValue,
}: {
  question: AiReadinessQuestion;
  error?: string;
  errorId: string;
  legendId: string;
  defaultValue?: string;
}) {
  const name = `question__${question.id}`;
  const errorLine = error ? (
    <p id={errorId} className="text-sm text-destructive">
      {error}
    </p>
  ) : null;
  if (question.answerType === "scale" && question.levels?.length) {
    // Ogni livello spiegato: si sceglie sapendo esattamente cosa significa
    // ciascun voto, mai al buio. "Non so" vale 0,5 nello score.
    return (
      <div className="grid gap-2">
        {question.levels.map((level) => (
          <label key={level.value} className={CHOICE}>
            <input
              type="radio"
              name={name}
              value={level.value}
              defaultChecked={defaultValue === String(level.value)}
              className="mt-1 size-4 shrink-0 accent-primary"
            />
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold">
              {level.value}
            </span>
            <span>{level.label}</span>
          </label>
        ))}
        {question.allowUnsure && (
          <label className={cn(CHOICE, "border-dashed text-muted-foreground")}>
            <input
              type="radio"
              name={name}
              value="0.5"
              defaultChecked={defaultValue === "0.5"}
              className="mt-1 size-4 shrink-0 accent-primary"
            />
            <span aria-hidden className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold">
              ?
            </span>
            <span>{F.unsure}</span>
          </label>
        )}
        {errorLine}
      </div>
    );
  }
  if (question.answerType === "scale") {
    return (
      <div className="grid gap-3">
        <div className="grid grid-cols-6 gap-1.5">
          {[0, 1, 2, 3, 4, 5].map((value) => (
            <label
              key={value}
              className="flex min-h-11 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-border p-2 hover:bg-muted has-checked:border-primary has-checked:bg-primary/10"
            >
              <input
                type="radio"
                name={name}
                value={value}
                defaultChecked={defaultValue === String(value)}
                className="accent-primary"
              />
              <span className="font-semibold">{value}</span>
            </label>
          ))}
        </div>
        <div className="flex justify-between gap-4 text-sm text-muted-foreground">
          <span className="max-w-[45%]">
            0 = {question.scaleAnchors?.min ?? F.scaleMin}
          </span>
          <span className="max-w-[45%] text-right">
            5 = {question.scaleAnchors?.max ?? F.scaleMax}
          </span>
        </div>
        {errorLine}
      </div>
    );
  }
  if (question.answerType === "single_choice") {
    return (
      <div className="grid gap-2">
        {question.options?.map((option) => (
          <label key={option.value} className={cn(CHOICE, "items-center")}>
            <input
              type="radio"
              name={name}
              value={option.value}
              defaultChecked={defaultValue === option.value}
              className="size-4 shrink-0 accent-primary"
            />
            <span>{option.label}</span>
          </label>
        ))}
        {errorLine}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <Textarea
        name={name}
        aria-labelledby={legendId}
        placeholder={F.freeText}
        defaultValue={defaultValue}
        className="text-base md:text-base"
      />
      {errorLine}
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
  const identityValue = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" ? value.trim() : "";
  };
  return {
    answers,
    consents: {
      // La presa visione non è un campo del modulo: si registra all'invio (il pulsante), mai in una bozza.
      privacyAccepted: formData.get("privacyAccepted") === "on",
      benchmarkConsent: formData.get("benchmarkConsent") === "on",
      marketingConsent: formData.get("marketingConsent") === "on",
    },
    useCase,
    identity: {
      firstName: identityValue("respondentFirstName"),
      lastName: identityValue("respondentLastName"),
    },
  };
}

/** I campi del modulo facoltativo dei casi d'uso, nell'ordine e con il tipo di prima. */
const USE_CASE_FIELDS: ReadonlyArray<{ name: keyof typeof U.fields; kind: "input" | "textarea" | "number" }> = [
  { name: "useCaseTitle", kind: "input" },
  { name: "useCaseFrequency", kind: "input" },
  { name: "useCaseCurrentProcess", kind: "textarea" },
  { name: "useCasePainPoint", kind: "textarea" },
  { name: "useCaseDesiredOutcome", kind: "textarea" },
  { name: "useCaseAiHypothesis", kind: "textarea" },
  { name: "useCaseBeneficiaries", kind: "number" },
  { name: "useCaseRiskLevel", kind: "input" },
  { name: "useCaseDataNeeded", kind: "textarea" },
  { name: "useCaseHumanInLoop", kind: "textarea" },
  { name: "useCaseRiskReasoning", kind: "textarea" },
  { name: "useCaseImpactEstimate", kind: "textarea" },
  { name: "useCaseToolsUsed", kind: "input" },
];

export function RespondentSurveyForm({
  token,
  template,
  brandConfig,
  privacyConfig,
  initialDraft,
  draftSavedAt,
  anonymousMode = true,
  useCaseModule = true,
  noticeHref,
  initialIdentity,
}: {
  token: string;
  template: AiReadinessTemplateDefinition;
  brandConfig: Record<string, unknown> | null;
  privacyConfig: Record<string, unknown> | null;
  initialDraft?: AiReadinessDraftPayload | null;
  draftSavedAt?: string | null;
  anonymousMode?: boolean;
  /** Il modulo dei casi d'uso: per il questionario per tutti, mai per la scheda dei referenti. */
  useCaseModule?: boolean;
  /** L'informativa unica, «Come usiamo le tue risposte». */
  noticeHref: string;
  initialIdentity?: AiReadinessDraftIdentity;
}) {
  const action = submitAiReadinessResponseAction.bind(null, token);
  const [state, formAction, pending] = useActionState(action, INITIAL);
  const completed = state.data?.completed === true;
  const sections = template.sections;

  // Benchmark e comunicazioni sono disattivati in configurazione per questo
  // assessment: chiederli comunque significa raccogliere consensi che nessuno
  // potrà onorare.
  const benchmarkEnabled = privacyConfig?.allowBenchmarking === true;
  const marketingEnabled = privacyConfig?.marketingConsentEnabled === true;

  // Il modulo dei casi d'uso ha 13 campi: quando il questionario chiede già le idee con domande aperte (è il caso del
  // questionario per l'organizzazione) è un doppione, e non si mostra.
  const alreadyAsksForIdeas = template.questions.some(
    (question) =>
      question.answerType === "text" &&
      (question.pillarId === "use_cases" || question.id === "ad-future-usecase")
  );
  const showUseCase = useCaseModule && !alreadyAsksForIdeas;

  const formRef = useRef<HTMLFormElement>(null);
  const doneRef = useRef<HTMLElement>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);
  const pendingRef = useRef(pending);
  const completedRef = useRef(completed);
  // Gli ultimi valori per i salvataggi a tempo e per l'uscita dalla pagina: aggiornati alla conferma
  // del rendering (prima di ogni altro effetto e di ogni evento), non durante il rendering.
  useLayoutEffect(() => {
    pendingRef.current = pending;
    completedRef.current = completed;
  });

  const [saveStatus, setSaveStatus] = useState<SurveySaveStatus>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(
    draftSavedAt ?? null
  );
  const [restoredFromDevice, setRestoredFromDevice] = useState(false);
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});

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
    const form = formRef.current;
    const payload = form ? collectDraftPayload(form) : null;
    setAnsweredCount(countAnswered());
    // Salvataggio istantaneo sul dispositivo: anche chiudendo subito il
    // browser non si perde nulla, pure se il debounce server non è scattato.
    if (form && payload && !completedRef.current) {
      writeDeviceDraft(token, payload);
      setLocalErrors((current) => {
        const next: Record<string, string> = {};
        for (const [key, message] of Object.entries(current)) {
          if (key === "respondentFirstName" && payload.identity?.firstName) continue;
          if (key === "respondentLastName" && payload.identity?.lastName) continue;
          if (key.startsWith("question__")) {
            const questionId = key.slice("question__".length);
            if (payload.answers[questionId] != null) continue;
          }
          next[key] = message;
        }
        return next;
      });
    }
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void flushSave();
    }, AUTOSAVE_DEBOUNCE_MS);
  }, [countAnswered, flushSave, token]);

  // Ripristino dal dispositivo: se qui c'è una bozza più recente di quella
  // server (es. salvataggio remoto fallito o offline), riportala nel form.
  useEffect(() => {
    const form = formRef.current;
    if (!form || completedRef.current) return;
    const device = readDeviceDraft(token);
    if (!device) return;
    const deviceTime = Date.parse(device.savedAt) || 0;
    const serverTime = draftSavedAt ? Date.parse(draftSavedAt) || 0 : 0;
    if (deviceTime <= serverTime) return;
    applyPayloadToForm(form, device.payload);
    // Il form non è controllato e la bozza del dispositivo esiste solo nel browser: scritta nel DOM
    // dopo il montaggio, una volta sola, lo stato deve seguirla subito.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- ripristino della bozza dal dispositivo, al primo montaggio
    setAnsweredCount(countAnswered());
    setRestoredFromDevice(true);
    setSaveStatus("dirty");
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void flushSave();
    }, AUTOSAVE_DEBOUNCE_MS);
    // Solo al primo mount: il form è non controllato.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A invio riuscito, la bozza locale non serve più; il grazie prende il fuoco, in vista.
  useEffect(() => {
    if (!completed) return;
    clearDeviceDraft(token);
    doneRef.current?.focus();
    doneRef.current?.scrollIntoView({ block: "start" });
  }, [completed, token]);

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
      <section ref={doneRef} tabIndex={-1} role="status" className="mt-6 rounded-xl bg-card p-5 ring-1 ring-foreground/10 outline-none sm:p-6" data-testid="survey-done">
        <h2 className="text-xl font-semibold">{F.doneTitle}</h2>
        <p className="mt-2 text-muted-foreground">
          {brandCopy(brandConfig, "completionCopy", AI_READINESS_DEFAULT_COPY.completion)}
        </p>
      </section>
    );
  }

  const progressPercent =
    totalQuestions > 0
      ? Math.round((answeredCount / totalQuestions) * 100)
      : 0;
  const savedTimeLabel = formatTime(lastSavedAt);
  const progressLabel = surveyProgressLabel({ answered: answeredCount, total: totalQuestions, status: saveStatus, savedTime: savedTimeLabel });
  const useCaseDraft = USE_CASE_DRAFT_FIELDS.some((field) => Boolean(initialDraft?.useCase?.[field]));
  const errorOf = (name: string) => localErrors[name] || state.fieldErrors?.[name];

  return (
    <form
      ref={formRef}
      action={formAction}
      onChange={scheduleSave}
      noValidate
      onSubmit={(event) => {
        const form = event.currentTarget;
        // La presa visione è il tocco su «Invia le risposte», che la porta con sé: non si controlla come un campo.
        const payload = collectDraftPayload(form);
        const errors = validateSurveyPayload({ template, payload: { ...payload, consents: { ...payload.consents, privacyAccepted: true } }, anonymousMode });
        event.preventDefault();
        if (Object.keys(errors).length === 0) {
          setLocalErrors({});
          // L'invio con la presa visione: la si aggiunge qui, perché il FormData che React costruisce porta il pulsante
          // solo nei browser che lo sanno fare (Safari da 16.4). Senza script la porta il pulsante stesso.
          const data = new FormData(form);
          data.set("privacyAccepted", "on");
          startTransition(() => formAction(data));
          return;
        }
        setLocalErrors(errors);
        const first = Object.keys(errors)[0];
        const target =
          form.querySelector<HTMLElement>(`[name="${CSS.escape(first)}"]`) ??
          form.querySelector<HTMLElement>(`[name="${CSS.escape(first)}"] + *`);
        target?.scrollIntoView({ behavior: "smooth", block: "center" });
      }}
      className="mt-6 space-y-8"
    >
      <div
        className="sticky top-0 z-10 -mx-4 border-b border-border bg-background/95 px-4 py-2 backdrop-blur sm:-mx-6 sm:px-6"
        data-testid="survey-progress"
      >
        <p
          className={cn("min-h-6 text-sm", saveStatus === "error" ? "text-destructive" : "text-muted-foreground")}
          role="status"
          data-testid="survey-save-status"
        >
          {progressLabel}
        </p>
        <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted" aria-hidden>
          <div
            className="h-full rounded-full bg-primary transition-all motion-reduce:transition-none"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {(initialDraft || restoredFromDevice) && (
        <p className="rounded-xl bg-muted px-4 py-3" data-testid="survey-resume-banner">
          {restoredFromDevice
            ? F.resumedDevice
            : savedTimeLabel
              ? F.resumedAt.replace("{ora}", savedTimeLabel)
              : F.resumed}
        </p>
      )}

      {!anonymousMode && (
        <section className="space-y-4" data-testid="survey-identity-section">
          <div>
            <h2 className="text-xl font-semibold">{F.identityTitle}</h2>
            <p className="mt-1 text-muted-foreground">{F.identityText}</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {(["respondentFirstName", "respondentLastName"] as const).map((name) => (
              <div key={name} className="space-y-1.5">
                <Label htmlFor={name} className={PUBLIC_LABEL}>
                  {name === "respondentFirstName" ? F.firstName : F.lastName} <span className="text-destructive">*</span>
                </Label>
                <Input
                  id={name}
                  name={name}
                  className={PUBLIC_FIELD}
                  autoComplete={name === "respondentFirstName" ? "given-name" : "family-name"}
                  defaultValue={name === "respondentFirstName" ? initialIdentity?.firstName : initialIdentity?.lastName}
                  aria-invalid={Boolean(errorOf(name))}
                  aria-describedby={errorOf(name) ? `${name}-errore` : undefined}
                />
                {errorOf(name) && (
                  <p id={`${name}-errore`} className="text-sm text-destructive">
                    {errorOf(name)}
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {sections.map((section) => (
        <section key={section.id} className="space-y-6">
          <div>
            <h2 className="text-xl font-semibold break-words">{section.title}</h2>
            {section.description && (
              <p className="mt-1 text-muted-foreground">{section.description}</p>
            )}
          </div>
          {template.questions
            .filter((question) => question.sectionId === section.id)
            .map((question) => {
              const fieldName = `question__${question.id}`;
              const error = errorOf(fieldName);
              const legendId = `domanda-${question.id}`;
              const errorId = `domanda-${question.id}-errore`;
              return (
                <fieldset key={question.id} className="min-w-0 space-y-3" aria-describedby={error ? errorId : undefined}>
                  <legend id={legendId} className="text-base leading-6 font-medium">
                    {question.label}
                    {question.required ? (
                      <>
                        <span aria-hidden className="text-destructive">
                          {" "}
                          *
                        </span>
                        <span className="sr-only"> ({F.required})</span>
                      </>
                    ) : null}
                  </legend>
                  {question.description && (
                    <p className="text-sm text-muted-foreground">{question.description}</p>
                  )}
                  <QuestionField
                    question={question}
                    error={error}
                    errorId={errorId}
                    legendId={legendId}
                    defaultValue={initialDraft?.answers[question.id]}
                  />
                </fieldset>
              );
            })}
        </section>
      ))}

      {showUseCase && (
        <Fold id="caso-d-uso" title={U.title} summary={U.summary} defaultOpen={useCaseDraft} className="last:border-b">
          <p className="text-muted-foreground">{U.intro}</p>
          <div className="space-y-4">
            {USE_CASE_FIELDS.map((field) => {
              const id = `uc-${field.name}`;
              const value = initialDraft?.useCase?.[field.name];
              return (
                <div key={field.name} className="space-y-1.5">
                  <Label htmlFor={id} className={PUBLIC_LABEL}>
                    {U.fields[field.name]}
                  </Label>
                  {field.kind === "textarea" ? (
                    <Textarea id={id} name={field.name} defaultValue={value} className="text-base md:text-base" />
                  ) : (
                    <Input id={id} name={field.name} type={field.kind === "number" ? "number" : "text"} min={field.kind === "number" ? 0 : undefined} defaultValue={value} className={PUBLIC_FIELD} />
                  )}
                </div>
              );
            })}
          </div>
        </Fold>
      )}

      <div className="space-y-4">
        {(benchmarkEnabled || marketingEnabled) && (
          <div className="space-y-2">
            {benchmarkEnabled && (
              <label className="flex min-h-11 items-start gap-3 rounded-xl border border-border p-3">
                <Checkbox
                  name="benchmarkConsent"
                  className="mt-0.5"
                  defaultChecked={initialDraft?.consents.benchmarkConsent === true}
                />
                <span>{F.benchmark}</span>
              </label>
            )}
            {marketingEnabled && (
              <label className="flex min-h-11 items-start gap-3 rounded-xl border border-border p-3">
                <Checkbox
                  name="marketingConsent"
                  className="mt-0.5"
                  defaultChecked={initialDraft?.consents.marketingConsent === true}
                />
                <span>{F.marketing}</span>
              </label>
            )}
          </div>
        )}

        {Object.keys(localErrors).length > 0 && (
          <div className="rounded-xl bg-destructive/10 px-4 py-3 text-destructive" role="alert" data-testid="survey-error-summary">
            <p className="font-medium">{F.missing}</p>
            <p className="mt-1 text-sm">{F.missingUnsure}</p>
          </div>
        )}

        {state.message && !completed && (
          <p className={state.ok ? "text-muted-foreground" : "text-destructive"} role={state.ok ? "status" : "alert"}>
            {state.message}
          </p>
        )}

        <p className="text-muted-foreground" data-testid="survey-acknowledge">
          {F.acknowledge}{" "}
          <a href={noticeHref} className={cn(PUBLIC_LINK, "text-foreground")}>
            {PUBLIC_TEXT.notice}
          </a>
          .
        </p>
        {/* La presa visione dell'informativa viaggia con l'invio (`privacyAccepted`): il pulsante la porta anche senza script. */}
        <Button type="submit" name="privacyAccepted" value="on" className={PUBLIC_PRIMARY} disabled={pending} data-testid="survey-submit">
          {pending ? F.submitting : F.submit}
        </Button>
      </div>
    </form>
  );
}
