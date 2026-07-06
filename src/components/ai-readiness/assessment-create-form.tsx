"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createAiReadinessAssessmentAction, type AiReadinessActionState } from "@/lib/actions/ai-readiness";
import { AI_READINESS_SYSTEM_TEMPLATE } from "@/lib/ai-readiness/default-template";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const INITIAL: AiReadinessActionState<{ assessmentId: string }> = { ok: true };

const PILLAR_HINTS: Record<string, string> = {
  technology: "Stack, strumenti approvati, governance tecnica. Tipico per IT o poche persone.",
  context: "Conoscenza condivisa, documentazione, contesto organizzativo.",
  workflow: "Processi, automazioni, flussi operativi dei team.",
  adoption: "Uso reale dell'AI da parte delle persone. Tipico per tutta l'organizzazione.",
  use_cases: "Raccolta di casi d'uso concreti proposti dai dipendenti.",
};

export function AssessmentCreateForm({ workspaceId, workspaceName }: { workspaceId: string; workspaceName: string }) {
  const router = useRouter();
  const action = createAiReadinessAssessmentAction.bind(null, workspaceId);
  const [state, formAction, pending] = useActionState(action, INITIAL);

  useEffect(() => {
    // Dopo la creazione, apri direttamente il nuovo assessment.
    if (state.ok && state.data?.assessmentId) {
      router.push(
        `/dashboard/${workspaceId}/ai-readiness?assessment=${state.data.assessmentId}`
      );
    }
  }, [state.ok, state.data?.assessmentId, router, workspaceId]);

  return (
    <Card className="overflow-hidden rounded-[28px]">
      <CardHeader className="border-b bg-linear-to-br from-emerald-500/10 via-background to-sky-500/10">
        <CardTitle>Setup cliente</CardTitle>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Crea la diagnosi AI Readiness OS dentro questo workspace. Il template
          core misura Technology, Context, Workflow, Adoption e Use Cases.
        </p>
      </CardHeader>
      <CardContent className="p-6">
        <form action={formAction} className="grid gap-5 lg:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="name">Nome assessment</Label>
            <Input id="name" name="name" defaultValue={`AI Readiness - ${workspaceName}`} />
            {state.fieldErrors?.name && <p className="text-xs text-destructive">{state.fieldErrors.name}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="displayName">Nome visibile ai respondent</Label>
            <Input id="displayName" name="displayName" defaultValue={workspaceName} />
          </div>
          <div className="space-y-2 lg:col-span-2">
            <Label htmlFor="description">Descrizione interna</Label>
            <Textarea id="description" name="description" placeholder="Es. Assessment iniziale per misurare readiness e prioritizzare la roadmap AI." />
          </div>
          <fieldset className="space-y-2 lg:col-span-2">
            <legend className="text-sm font-medium">Aree da misurare</legend>
            <p className="text-xs text-muted-foreground">
              Scegli i pilastri per questo assessment: puoi creare assessment
              mirati (es. solo Adoption per tutta l&apos;organizzazione, solo
              Technology per l&apos;IT) e inviarli a persone diverse.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {AI_READINESS_SYSTEM_TEMPLATE.pillars.map((pillar) => (
                <label
                  key={pillar.id}
                  className="flex cursor-pointer items-start gap-3 rounded-2xl border p-3 text-sm has-checked:border-emerald-500 has-checked:bg-emerald-500/5"
                >
                  <input
                    type="checkbox"
                    name="pillars"
                    value={pillar.id}
                    defaultChecked
                    className="mt-1"
                  />
                  <span>
                    <span className="font-medium">{pillar.title}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {PILLAR_HINTS[pillar.id] ?? pillar.description}
                    </span>
                  </span>
                </label>
              ))}
            </div>
            {state.fieldErrors?.pillars && (
              <p className="text-xs text-destructive">{state.fieldErrors.pillars}</p>
            )}
          </fieldset>
          <fieldset className="space-y-2 lg:col-span-2">
            <legend className="text-sm font-medium">Modalità survey</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex cursor-pointer items-start gap-3 rounded-2xl border p-4 text-sm has-checked:border-emerald-500 has-checked:bg-emerald-500/5">
                <input
                  type="radio"
                  name="surveyMode"
                  value="anonymous"
                  defaultChecked
                  className="mt-1"
                />
                <span>
                  <span className="font-medium">Anonima (consigliata)</span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    Le risposte restano pseudonime: massima sincerità dei
                    dipendenti, solo dati aggregati.
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-3 rounded-2xl border p-4 text-sm has-checked:border-emerald-500 has-checked:bg-emerald-500/5">
                <input type="radio" name="surveyMode" value="named" className="mt-1" />
                <span>
                  <span className="font-medium">Nominativa</span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    A ogni dipendente vengono chiesti nome e cognome (senza
                    registrazione né account).
                  </span>
                </span>
              </label>
            </div>
          </fieldset>
          <div className="space-y-2 lg:col-span-2">
            <Label htmlFor="introCopy">Intro survey</Label>
            <Textarea
              id="introCopy"
              name="introCopy"
              defaultValue="Questa diagnosi misura la readiness AI dell'organizzazione. Non e un esame: serve a capire dove aiutare meglio team, processi e tecnologia."
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="controllerName">Titolare del trattamento</Label>
            <Input id="controllerName" name="controllerName" defaultValue={workspaceName} />
            {state.fieldErrors?.controllerName && <p className="text-xs text-destructive">{state.fieldErrors.controllerName}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="processorName">Responsabile / processore</Label>
            <Input id="processorName" name="processorName" defaultValue="Unbundle / Lateral Space" />
            {state.fieldErrors?.processorName && <p className="text-xs text-destructive">{state.fieldErrors.processorName}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="legalBasis">Base giuridica</Label>
            <Input id="legalBasis" name="legalBasis" defaultValue="Legittimo interesse / misurazione organizzativa" />
            {state.fieldErrors?.legalBasis && <p className="text-xs text-destructive">{state.fieldErrors.legalBasis}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="privacyNoticeUrl">Privacy notice URL</Label>
            <Input id="privacyNoticeUrl" name="privacyNoticeUrl" placeholder="https://..." />
          </div>
          <div className="space-y-2">
            <Label htmlFor="supportEmail">Email supporto</Label>
            <Input id="supportEmail" name="supportEmail" type="email" placeholder="ai-readiness@azienda.com" />
            {state.fieldErrors?.supportEmail && <p className="text-xs text-destructive">{state.fieldErrors.supportEmail}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="dpoEmail">DPO email opzionale</Label>
            <Input id="dpoEmail" name="dpoEmail" type="email" placeholder="privacy@azienda.com" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="dataRetentionDays">Retention dati</Label>
            <Input id="dataRetentionDays" name="dataRetentionDays" type="number" min={30} max={3650} defaultValue={365} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="aggregationThreshold">Soglia aggregazione minima</Label>
            <Input id="aggregationThreshold" name="aggregationThreshold" type="number" min={3} max={50} defaultValue={5} />
          </div>
          <div className="lg:col-span-2">
            {state.message && (
              <p className={`mb-3 text-sm ${state.ok ? "text-emerald-600" : "text-destructive"}`}>
                {state.message}
              </p>
            )}
            <Button type="submit" disabled={pending}>
              {pending ? "Creo assessment..." : "Crea Assessment Core"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
