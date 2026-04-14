import { streamText, tool, stepCountIs } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { toAiMessages } from "chat";
import type { Thread, Message } from "chat";
import {
  getOrCreateDraft,
  updateDraft,
  markDraftSubmitted,
} from "@/lib/db/queries/slack";
import { createUseCase } from "@/lib/db/queries/use-cases";
import { notifyNewUseCase } from "./notifications";

const SYSTEM_PROMPT = `Sei l'agente AI di Unbundle. Aiuti gli utenti business a proporre use case AI in modo strutturato.

## IL TUO RUOLO
Guidi l'utente passo dopo passo nella compilazione di uno use case AI. Sei amichevole, competente e conciso. Non fai lezioni — fai domande e rielabori le risposte.

## TEMPLATE USE CASE
Devi raccogliere queste informazioni, una alla volta:

1. **Titolo**: nome conciso dello use case (es. "Automazione proposte commerciali")
2. **Problema**: quale problema risolve e perché ora è il momento giusto
3. **Flusso (as-is → to-be)**: come funziona oggi vs come funzionerebbe con AI
4. **Human in the Loop**: dove serve intervento umano, chi approva, quando
5. **Guardrail**: limiti, vincoli, rischi da mitigare
6. **Impatto atteso**: tempo risparmiato, qualità, revenue, costi
7. **Dati necessari**: quali dati servono, dove sono, chi li gestisce
8. **Urgenza**: quick win (settimane) o progetto strutturato (mesi)

## REGOLE DI CONVERSAZIONE
- **UNA domanda per turno.** Mai due contemporaneamente.
- **Rielabora** sempre quello che l'utente dice prima di passare oltre.
- **Max 3-4 righe per messaggio.** Sii conciso.
- Quando un campo è compilato, usa il tool \`saveDraftField\` per salvarlo.
- Quando tutti i campi sono compilati, mostra un riepilogo e chiedi conferma.
- Quando l'utente conferma, usa il tool \`submitUseCase\` per sottomettere.
- **Parla sempre in italiano.**

## PRIMO MESSAGGIO
Se l'utente ti tagga senza un contesto specifico, presentati brevemente:
"Ciao! Sono Unbundle — posso aiutarti a strutturare un'idea di use case AI. Iniziamo dal titolo: come chiameresti questo use case?"

Se l'utente arriva già con un'idea, rielabora e parti dal campo più appropriato.`;

function getUseCaseTools(workspaceId: string, slackUserId: string, slackTeamId: string, threadTs?: string) {
  return {
    saveDraftField: tool({
      description:
        "Salva un campo del draft use case. Chiama questo tool ogni volta che l'utente fornisce informazioni su un campo del template.",
      inputSchema: z.object({
        field: z.enum([
          "title",
          "problem",
          "flowDescription",
          "humanInTheLoop",
          "guardrails",
          "expectedImpact",
          "dataRequirements",
          "urgency",
        ]),
        value: z.string().describe("Il valore del campo, rielaborato e strutturato"),
      }),
      execute: async ({ field, value }) => {
        const draft = await getOrCreateDraft(workspaceId, slackUserId, slackTeamId, threadTs);
        await updateDraft(draft.id, { [field]: value });
        return { success: true, field, draftId: draft.id };
      },
    }),

    submitUseCase: tool({
      description:
        "Sottometti il use case completato. Chiama solo quando l'utente ha confermato tutti i campi.",
      inputSchema: z.object({
        draftId: z.string().describe("ID del draft da sottomettere"),
      }),
      execute: async ({ draftId }) => {
        const draft = await markDraftSubmitted(draftId);
        if (!draft) return { success: false, error: "Draft non trovato" };

        const useCase = await createUseCase({
          workspaceId,
          title: draft.title ?? "Use case senza titolo",
          description: draft.problem,
          businessCase: draft.expectedImpact,
          status: "proposed",
          source: "slack_proposed",
          proposedBy: slackUserId,
          flowDescription: draft.flowDescription,
          humanInTheLoop: draft.humanInTheLoop,
          guardrails: draft.guardrails,
          dataRequirements: draft.dataRequirements,
        });

        await notifyNewUseCase(useCase, slackTeamId, workspaceId);

        return {
          success: true,
          useCaseId: useCase.id,
          title: useCase.title,
        };
      },
    }),

    getDraftStatus: tool({
      description: "Controlla lo stato attuale del draft per sapere quali campi mancano.",
      inputSchema: z.object({}),
      execute: async () => {
        const draft = await getOrCreateDraft(workspaceId, slackUserId, slackTeamId, threadTs);

        const fields = {
          title: draft.title,
          problem: draft.problem,
          flowDescription: draft.flowDescription,
          humanInTheLoop: draft.humanInTheLoop,
          guardrails: draft.guardrails,
          expectedImpact: draft.expectedImpact,
          dataRequirements: draft.dataRequirements,
          urgency: draft.urgency,
        };

        const completed = Object.entries(fields)
          .filter(([, v]) => v != null && v.length > 0)
          .map(([k]) => k);

        const missing = Object.entries(fields)
          .filter(([, v]) => !v || v.length === 0)
          .map(([k]) => k);

        return {
          draftId: draft.id,
          completed,
          missing,
          isComplete: missing.length === 0,
        };
      },
    }),
  };
}

export async function handleUseCaseConversation(
  thread: Thread,
  message: Message,
  workspaceId: string
) {
  const slackUserId = message.author?.userId ?? "unknown";
  const teamId = (message.raw as Record<string, string>)?.team ?? "";
  const threadTs = (message.raw as Record<string, string>)?.thread_ts;

  const allMessages: Message[] = [];
  try {
    for await (const msg of thread.allMessages) {
      allMessages.push(msg);
    }
  } catch {
    allMessages.push(message);
  }

  const history = await toAiMessages(allMessages);

  const tools = getUseCaseTools(workspaceId, slackUserId, teamId, threadTs);

  const result = streamText({
    model: anthropic("claude-sonnet-4-20250514"),
    system: SYSTEM_PROMPT,
    messages: history,
    tools,
    stopWhen: stepCountIs(15),
    onError: ({ error }) => {
      console.error("[slack/use-case-agent] streamText error:", error);
    },
  });

  await thread.post(result.textStream);
}
