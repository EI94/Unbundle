"use client";

import { useActionState, useEffect, useState } from "react";
import {
  updateAiTransformationTeamNameAction,
  updateWhatsappWebhookAction,
  type ActionState,
} from "@/lib/actions/portfolio";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";

const INITIAL: ActionState = { ok: true };

export function TeamNameForm({
  workspaceId,
  initialName,
}: {
  workspaceId: string;
  initialName: string;
}) {
  const boundAction = updateAiTransformationTeamNameAction.bind(null, workspaceId);
  const [state, formAction, pending] = useActionState(boundAction, INITIAL);
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const isDirty = name.trim() !== initialName.trim();

  useEffect(() => {
    if (state.ok && state.message) router.refresh();
  }, [router, state.message, state.ok]);

  return (
    <form action={formAction} className="space-y-3">
      <label className="text-sm font-medium">
        Nome team (usato in UI e notifiche)
      </label>
      <Input
        name="aiTransformationTeamName"
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="es. AI Transformation, CoE AI, Digital Factory…"
      />
      <Button
        type="submit"
        variant="outline"
        className="w-full"
        disabled={pending || !isDirty}
      >
        {pending ? "Salvo…" : isDirty ? "Salva" : "Salvato"}
      </Button>
      {state.message && (
        <p
          className={`text-xs ${state.ok ? "text-green-500" : "text-red-500"}`}
        >
          {state.message}
        </p>
      )}
    </form>
  );
}

export function WhatsappWebhookForm({
  workspaceId,
  initialUrl,
}: {
  workspaceId: string;
  initialUrl: string;
}) {
  const boundAction = updateWhatsappWebhookAction.bind(null, workspaceId);
  const [state, formAction, pending] = useActionState(boundAction, INITIAL);
  const router = useRouter();
  const [url, setUrl] = useState(initialUrl);
  const isDirty = url.trim() !== initialUrl.trim();

  useEffect(() => {
    if (state.ok && state.message) router.refresh();
  }, [router, state.message, state.ok]);

  return (
    <form action={formAction} className="space-y-2">
      <label className="text-sm font-medium">
        Webhook WhatsApp del team (opzionale)
      </label>
      <Input
        name="whatsappWebhookUrl"
        value={url}
        onChange={(event) => setUrl(event.target.value)}
        placeholder="https://hook.make.com/… oppure Zapier / Twilio / endpoint custom"
        aria-invalid={!!state.fieldErrors?.whatsappWebhookUrl}
      />
      {state.fieldErrors?.whatsappWebhookUrl && (
        <p className="text-xs text-red-500">
          {state.fieldErrors.whatsappWebhookUrl}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Se impostato, Unbundle invia un POST JSON{" "}
        <code className="font-mono">{"{ text, link, event }"}</code> a ogni
        nuovo contributo. Usalo con un relay verso il gruppo WhatsApp del team
        (Zapier, Make, Twilio, o un tuo endpoint).
      </p>
      <Button
        type="submit"
        variant="outline"
        className="w-full"
        disabled={pending || !isDirty}
      >
        {pending ? "Salvo…" : isDirty ? "Salva webhook" : "Webhook salvato"}
      </Button>
      {state.message && (
        <p
          className={`text-xs ${state.ok ? "text-green-500" : "text-red-500"}`}
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
