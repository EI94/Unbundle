"use client";

import { useActionState, useState } from "react";
import {
  createPortfolioSubmissionAction,
  type ActionState,
} from "@/lib/actions/portfolio";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const INITIAL: ActionState = { ok: true };

type Kind = "best_practice" | "use_case_ai";

export function PortfolioSubmitForm({
  workspaceId,
  esgEnabled,
}: {
  workspaceId: string;
  esgEnabled: boolean;
}) {
  const [tab, setTab] = useState<Kind>("use_case_ai");
  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as Kind)}>
      <TabsList>
        <TabsTrigger value="use_case_ai">Use Case AI</TabsTrigger>
        <TabsTrigger value="best_practice">Best Practice</TabsTrigger>
      </TabsList>

      <TabsContent value="use_case_ai" className="mt-6">
        <InnerForm
          workspaceId={workspaceId}
          kind="use_case_ai"
          showGuardrails
          esgEnabled={esgEnabled}
        />
      </TabsContent>
      <TabsContent value="best_practice" className="mt-6">
        <InnerForm
          workspaceId={workspaceId}
          kind="best_practice"
          showGuardrails={false}
          esgEnabled={esgEnabled}
        />
      </TabsContent>
    </Tabs>
  );
}

function InnerForm({
  workspaceId,
  kind,
  showGuardrails,
  esgEnabled,
}: {
  workspaceId: string;
  kind: Kind;
  showGuardrails: boolean;
  esgEnabled: boolean;
}) {
  const boundAction = createPortfolioSubmissionAction.bind(null, workspaceId);
  const [state, formAction, pending] = useActionState(boundAction, INITIAL);
  const fe = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="portfolioKind" value={kind} />

      <Field
        label="Titolo"
        name="title"
        required
        placeholder="Dai un nome chiaro al contributo"
        error={fe.title}
      />
      <FieldArea
        label={kind === "best_practice" ? "Prima (problema / come funzionava)" : "Problema (perché serve)"}
        name="problem"
        required
        rows={4}
        placeholder="Contesto, frizione, perché è importante."
        error={fe.problem}
      />
      <FieldArea
        label={kind === "best_practice" ? "Adesso (come funziona con l'AI)" : "Flusso as-is → to-be"}
        name="flowDescription"
        required
        rows={4}
        placeholder="Passi principali, strumenti, dati, output."
        error={fe.flowDescription}
      />
      <FieldArea
        label={kind === "best_practice" ? "Risultato (beneficio osservato)" : "Impatto atteso"}
        name="expectedImpact"
        required
        rows={4}
        placeholder="Tempo, qualità, costo, ricavi, rischio…"
        error={fe.expectedImpact}
      />
      <FieldArea
        label="Human-in-the-loop"
        name="humanInTheLoop"
        required
        rows={3}
        placeholder="Chi fa cosa? Chi valida? Chi approva?"
        error={fe.humanInTheLoop}
      />
      {showGuardrails && (
        <FieldArea
          label="Guardrail"
          name="guardrails"
          rows={3}
          placeholder="Vincoli, compliance, privacy, tono di voce, escalation…"
          error={fe.guardrails}
        />
      )}
      <FieldArea
        label="Dati necessari"
        name="dataRequirements"
        required
        rows={3}
        placeholder="Che dati servono? Dove stanno? Sono disponibili?"
        error={fe.dataRequirements}
      />
      {esgEnabled && (
        <FieldArea
          label={
            kind === "best_practice"
              ? "Impatto ambientale e sociale (domanda 7)"
              : "Impatto ambientale e sociale (domanda 9)"
          }
          name="sustainabilityImpact"
          required
          rows={4}
          placeholder="Racconta il tipo di impatto ambientale e sociale che questo nuovo processo comporta."
          error={fe.sustainabilityImpact}
        />
      )}
      {kind === "use_case_ai" && (
        <Field
          label="Urgenza"
          name="urgency"
          placeholder="es. quick win / 3-6 mesi / 6-12 mesi"
          error={fe.urgency}
        />
      )}

      {state.message && !state.ok && (
        <div
          className="rounded-md border border-red-500/30 bg-red-500/5 text-red-500 p-3 text-sm"
          role="alert"
        >
          {state.message}
        </div>
      )}

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Invio…" : kind === "use_case_ai" ? "Invia use case AI" : "Invia best practice"}
      </Button>
    </form>
  );
}

function Field({
  label,
  name,
  placeholder,
  required,
  error,
}: {
  label: string;
  name: string;
  placeholder?: string;
  required?: boolean;
  error?: string;
}) {
  return (
    <div className="space-y-1">
      <label className="text-sm font-medium">{label}</label>
      <Input
        name={name}
        placeholder={placeholder}
        required={required}
        aria-invalid={!!error}
      />
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}

function FieldArea({
  label,
  name,
  placeholder,
  rows,
  required,
  error,
}: {
  label: string;
  name: string;
  placeholder?: string;
  rows?: number;
  required?: boolean;
  error?: string;
}) {
  return (
    <div className="space-y-1">
      <label className="text-sm font-medium">{label}</label>
      <Textarea
        name={name}
        placeholder={placeholder}
        rows={rows}
        required={required}
        aria-invalid={!!error}
      />
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
