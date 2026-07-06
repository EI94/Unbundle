"use client";

import { useActionState } from "react";
import {
  submitAiReadinessResponseAction,
  type AiReadinessActionState,
} from "@/lib/actions/ai-readiness";
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

function configString(config: Record<string, unknown> | null, key: string, fallback = "") {
  const value = config?.[key];
  return typeof value === "string" ? value : fallback;
}

function QuestionField({
  question,
  error,
}: {
  question: AiReadinessQuestion;
  error?: string;
}) {
  const name = `question__${question.id}`;
  if (question.answerType === "scale") {
    return (
      <div className="grid gap-3">
        <div className="grid grid-cols-6 gap-2">
          {[0, 1, 2, 3, 4, 5].map((value) => (
            <label
              key={value}
              className="flex cursor-pointer flex-col items-center gap-1 rounded-2xl border bg-background/70 p-2 text-sm hover:bg-muted"
            >
              <input required={question.required} type="radio" name={name} value={value} />
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
            className="flex cursor-pointer items-center gap-2 rounded-2xl border p-3 text-sm hover:bg-muted"
          >
            <input required={question.required} type="radio" name={name} value={option.value} />
            <span>{option.label}</span>
          </label>
        ))}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <Textarea name={name} placeholder="Risposta libera opzionale" />
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

export function RespondentSurveyForm({
  token,
  template,
  brandConfig,
  privacyConfig,
}: {
  token: string;
  template: AiReadinessTemplateDefinition;
  brandConfig: Record<string, unknown> | null;
  privacyConfig: Record<string, unknown> | null;
}) {
  const action = submitAiReadinessResponseAction.bind(null, token);
  const [state, formAction, pending] = useActionState(action, INITIAL);
  const completed = state.data?.completed === true;
  const sections = template.sections;

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

  return (
    <form action={formAction} className="space-y-8">
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
            <Checkbox name="privacyAccepted" />
            <span>Ho letto l&apos;informativa e accetto di partecipare all&apos;assessment.</span>
          </label>
          <label className="flex items-start gap-3 rounded-2xl border bg-background/60 p-3 text-sm">
            <Checkbox name="benchmarkConsent" />
            <span>Acconsento all&apos;uso aggregato e anonimo per benchmark futuri.</span>
          </label>
          <label className="flex items-start gap-3 rounded-2xl border bg-background/60 p-3 text-sm">
            <Checkbox name="marketingConsent" />
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
          <Input name="useCaseTitle" placeholder="Titolo use case" />
          <Input name="useCaseFrequency" placeholder="Frequenza del processo" />
          <Textarea name="useCaseCurrentProcess" placeholder="Processo attuale" />
          <Textarea name="useCasePainPoint" placeholder="Pain point" />
          <Textarea name="useCaseDesiredOutcome" placeholder="Outcome desiderato" />
          <Textarea name="useCaseAiHypothesis" placeholder="Ipotesi soluzione AI" />
          <Input name="useCaseBeneficiaries" type="number" min={0} placeholder="Beneficiari stimati" />
          <Input name="useCaseRiskLevel" placeholder="Rischio: basso, medio, alto" />
          <Textarea name="useCaseDataNeeded" placeholder="Dati necessari" />
          <Textarea name="useCaseHumanInLoop" placeholder="Controllo umano necessario" />
          <Textarea name="useCaseRiskReasoning" placeholder="Perche potrebbe essere rischioso?" />
          <Textarea name="useCaseImpactEstimate" placeholder="Impatto atteso" />
          <Input name="useCaseToolsUsed" placeholder="Tool attuali" />
        </div>
      </section>

      {state.message && (
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
