import { streamText, tool, stepCountIs, generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { toAiMessages } from "chat";
import type { Thread, Message } from "chat";
import {
  getOrCreateDraft,
  updateDraft,
  getDraftById,
  getSlackInstallationByTeamId,
} from "@/lib/db/queries/slack";
import { getWorkspaceById } from "@/lib/db/queries/workspaces";
import type { NewSlackUseCaseDraft } from "@/lib/db/schema";
import { submitSlackContributionDraft, getMissingSlackDraftFields } from "./submit-contribution";
import { buildContributionReviewBlocks } from "./contribution-review-blocks";
import { slackChatPostMessage } from "./slack-chat-post";

type SlackPortfolioKind = "best_practice" | "use_case_ai";

function buildSystemPrompt(esgEnabled: boolean) {
  return `Sei l'agente AI di Unbundle su Slack. Raccogli contributi bottom-up per il portfolio Unbundle.

## OBIETTIVO
Devi distinguere e raccogliere **due tipologie**:
1) **Best Practice (BP)**: qualcosa che l'utente ha GIÀ fatto con l'AI (prima/dopo, risultato, scaling).
2) **Use Case AI (UC)**: un'IDEA per applicare l'AI (problema, as-is → to-be, vincoli, impatto atteso).

## FLUSSO (sempre)
1) **ROUTING (prima cosa)**: se non sai ancora la tipologia, fai UNA domanda di smistamento:
«Vuoi condividere un processo o attività che hai già migliorato con l'AI, oppure vuoi segnalare un'idea per applicare l'AI a un processo, servizio o prodotto?»
2) Interpreta la risposta in linguaggio naturale. Se è ambigua, fai UNA domanda di chiarimento.
3) Quando sei sicuro, chiama il tool \`confirmContributionKind\` con \`best_practice\` oppure \`use_case_ai\`.
4) Solo dopo lo smistamento, raccogli i campi **uno alla volta** usando \`saveDraftField\`.
5) Quando tutti i campi richiesti sono completi, mostra un riepilogo in chat e chiama **una sola volta** \`publishReviewBlocks\` con il \`draftId\` (aggiunge nel thread i pulsanti Slack *Conferma invio* / *Modifica*).
6) L'utente può confermare **con i pulsanti** oppure **per iscritto**; dopo conferma esplicita scritta, chiama \`submitUseCase\`.

## TEMPLATE BP (${esgEnabled ? "7" : "6"} campi — mapping su colonne DB)
1) **Titolo** → campo tool \`title\` (domanda: "Come chiameresti questa pratica?")
2) **Prima** → campo tool \`problem\` (domanda: "Come funzionava prima dell'AI?")
3) **Adesso** → campo tool \`flowDescription\` (domanda: "Come funziona adesso? Che strumenti AI usi?")
4) **Risultato** → campo tool \`expectedImpact\` (domanda: "Che miglioramento hai visto? (tempo, qualità, costo)")
5) **Beneficiari** → campo tool \`humanInTheLoop\` (domanda: "Chi ne beneficia? Quante persone?")
6) **Replicabilità** → campo tool \`dataRequirements\` (domanda: "Altri team/funzioni potrebbero adottarla?")
${esgEnabled ? '7) **Impatto ambientale e sociale** → campo tool `sustainabilityImpact` (domanda: "Che tipo di impatto ambientale e sociale comporta questo nuovo processo?")' : ""}

Per BP: **NON** chiedere \`guardrails\` né \`urgency\`.

## TEMPLATE UC (${esgEnabled ? "9" : "8"} campi — mapping su colonne DB)
1) **Titolo** → \`title\`
2) **Problema** → \`problem\`
3) **Flusso as-is → to-be** → \`flowDescription\`
4) **Human-in-the-loop** → \`humanInTheLoop\`
5) **Guardrail** → \`guardrails\`
6) **Impatto atteso** → \`expectedImpact\` (come \`business_case\` al submit)
7) **Dati necessari** → \`dataRequirements\`
8) **Urgenza** → \`urgency\` (quick win vs progetto strutturato)
${esgEnabled ? '9) **Impatto ambientale e sociale** → `sustainabilityImpact` (domanda: "Che tipo di impatto ambientale e sociale comporta questo nuovo processo?")' : ""}

## REGOLE DI CONVERSAZIONE
- **UNA domanda per turno.** Mai due contemporaneamente.
- **Rielabora** sempre quello che l'utente dice prima di passare oltre.
- **Max 3-4 righe per messaggio.** Sii conciso.
- **Parla sempre in italiano.**

## PRIMO MESSAGGIO
Se l'utente ti tagga senza contesto, inizia dal ROUTING (domanda di smistamento).
Se l'utente è già chiarissimo (BP vs UC), salta la domanda generica e chiama subito \`confirmContributionKind\`.

${esgEnabled ? "## REGOLA ESG\nQuesto workspace ha ESG attivo. Non considerare completo il contributo finche non hai raccolto anche l'ultimo campo `sustainabilityImpact`, subito prima del riepilogo finale e del ringraziamento." : ""}`;
}

function getUseCaseTools(
  workspaceId: string,
  slackUserId: string,
  slackTeamId: string,
  threadTs: string | undefined,
  slackChannelId: string,
  slackThreadRootTs: string,
  esgEnabled: boolean
) {
  const slackContextPatch = (): Partial<NewSlackUseCaseDraft> => {
    const p: Partial<NewSlackUseCaseDraft> = { reminder24hSentAt: null };
    if (slackChannelId) p.slackChannelId = slackChannelId;
    if (slackThreadRootTs) p.slackThreadTs = slackThreadRootTs;
    return p;
  };

  return {
    confirmContributionKind: tool({
      description:
        "Imposta la tipologia del contributo Slack: best_practice oppure use_case_ai. Chiamalo solo quando sei sicuro.",
      inputSchema: z.object({
        kind: z.enum(["best_practice", "use_case_ai"]),
      }),
      execute: async ({ kind }) => {
        const draft = await getOrCreateDraft(
          workspaceId,
          slackUserId,
          slackTeamId,
          threadTs,
          null
        );

        await updateDraft(draft.id, {
          ...slackContextPatch(),
          contributionKind: kind,
          // se cambio percorso, evito mismatch: reset campi opzionali UC-only
          ...(kind === "best_practice"
            ? { guardrails: null, urgency: null }
            : {}),
        });

        return { success: true, draftId: draft.id, kind };
      },
    }),

    classifyContributionIntent: tool({
      description:
        "Classifica l'intent dell'utente (BP vs UC) a partire dalla risposta alla domanda di smistamento. Usa questo tool quando vuoi una decisione strutturata.",
      inputSchema: z.object({
        userMessage: z.string(),
      }),
      execute: async ({ userMessage }) => {
        const { object } = await generateObject({
          model: anthropic("claude-sonnet-4-20250514"),
          schema: z.object({
            intent: z.enum(["best_practice", "use_case_ai", "ambiguous"]),
            confidence: z.number().min(0).max(1),
            rationale: z.string(),
          }),
          prompt: `L'utente ha risposto alla domanda:
"Vuoi condividere un processo o attività che hai già migliorato con l'AI, oppure vuoi segnalare un'idea per applicare l'AI a un processo, servizio o prodotto?"

Risposta utente:
"""${userMessage}"""

Classifica:
- best_practice: descrive qualcosa che ha GIÀ fatto / già in uso / risultati già ottenuti
- use_case_ai: propone un'IDEA / vorrebbe / potremmo / in futuro
- ambiguous: non è chiaro

Sii conservativo: se non è chiaro, ambiguous.`,
        });

        return object;
      },
    }),

    saveDraftField: tool({
      description:
        "Salva un campo del draft. Chiama questo tool solo DOPO aver impostato la tipologia con confirmContributionKind. Chiama ogni volta che l'utente fornisce informazioni su un campo del template.",
      inputSchema: z.object({
        field: z.enum([
          "title",
          "problem",
          "flowDescription",
          "humanInTheLoop",
          "guardrails",
          "expectedImpact",
          "dataRequirements",
          "sustainabilityImpact",
          "urgency",
        ]),
        value: z.string().describe("Il valore del campo, rielaborato e strutturato"),
      }),
      execute: async ({ field, value }) => {
        const draft = await getOrCreateDraft(
          workspaceId,
          slackUserId,
          slackTeamId,
          threadTs,
          null
        );

        if (!draft.contributionKind) {
          return {
            success: false,
            error:
              "Tipologia non impostata. Prima chiama confirmContributionKind (o chiedi chiarimenti).",
          };
        }

        if (draft.contributionKind === "best_practice") {
          if (field === "guardrails" || field === "urgency") {
            return {
              success: false,
              error:
                "Per Best Practice non usare guardrails/urgency. Usa i 6 campi del template BP.",
            };
          }
        }

        await updateDraft(draft.id, { ...slackContextPatch(), [field]: value });
        return { success: true, field, draftId: draft.id };
      },
    }),

    publishReviewBlocks: tool({
      description:
        "Pubblica nel thread Slack un riepilogo Block Kit con pulsanti Conferma/Modifica. Chiama una sola volta quando il draft è completo (dopo getDraftStatus con isComplete true).",
      inputSchema: z.object({
        draftId: z.string().describe("ID del draft (da getDraftStatus)"),
      }),
      execute: async ({ draftId }) => {
        const draft = await getDraftById(draftId);
        if (!draft || draft.slackUserId !== slackUserId || draft.workspaceId !== workspaceId) {
          return {
            success: false,
            error: "Draft non trovato o non appartiene a questa conversazione.",
          };
        }

        const kind = draft.contributionKind as SlackPortfolioKind | null;
        if (!kind) {
          return { success: false, error: "Tipologia non impostata sul draft." };
        }

        const missing = getMissingSlackDraftFields(draft, kind, { esgEnabled });
        if (missing.length > 0) {
          return { success: false, error: `Campi mancanti: ${missing.join(", ")}` };
        }

        if (!slackChannelId || !slackThreadRootTs) {
          return {
            success: false,
            error:
              "Contesto Slack incompleto (canale/thread). Chiedi all'utente di scrivere dal thread dove ha iniziato la conversazione.",
          };
        }

        await updateDraft(draftId, slackContextPatch());

        const installation = await getSlackInstallationByTeamId(slackTeamId);
        if (!installation?.botToken) {
          return { success: false, error: "Token Slack workspace non disponibile." };
        }

        const blocks = buildContributionReviewBlocks({ draft, workspaceId });
        const summaryText =
          kind === "best_practice"
            ? "Riepilogo Best Practice — conferma con i pulsanti qui sotto."
            : "Riepilogo Use Case AI — conferma con i pulsanti qui sotto.";

        try {
          await slackChatPostMessage({
            botToken: installation.botToken,
            channel: slackChannelId,
            threadTs: slackThreadRootTs,
            text: summaryText,
            blocks: blocks as unknown[],
          });
        } catch (e) {
          console.error("[slack/use-case-agent] publishReviewBlocks:", e);
          return {
            success: false,
            error: "Impossibile pubblicare il riepilogo su Slack. Riprova tra poco.",
          };
        }

        return {
          success: true,
          message:
            "Riepilogo pubblicato nel thread con pulsanti. L'utente può confermare da lì o per iscritto.",
        };
      },
    }),

    submitUseCase: tool({
      description:
        "Sottometti il use case completato quando l'utente conferma **per iscritto** (se ha usato il pulsante *Conferma invio* su Slack, l'invio è già avvenuto: non richiamare questo tool).",
      inputSchema: z.object({
        draftId: z.string().describe("ID del draft da sottomettere"),
      }),
      execute: async ({ draftId }) => {
        const result = await submitSlackContributionDraft({
          draftId,
          actingSlackUserId: slackUserId,
          expectedWorkspaceId: workspaceId,
        });

        if (!result.ok) {
          return { success: false, error: result.error };
        }

        return {
          success: true,
          useCaseId: result.useCaseId,
          title: result.title,
        };
      },
    }),

    getDraftStatus: tool({
      description: "Controlla lo stato attuale del draft per sapere quali campi mancano.",
      inputSchema: z.object({}),
      execute: async () => {
        const draft = await getOrCreateDraft(
          workspaceId,
          slackUserId,
          slackTeamId,
          threadTs,
          null
        );

        const kind = draft.contributionKind as SlackPortfolioKind | null;

        const fields =
          kind === "best_practice"
            ? {
                title: draft.title,
                problem: draft.problem,
                flowDescription: draft.flowDescription,
                expectedImpact: draft.expectedImpact,
                humanInTheLoop: draft.humanInTheLoop,
                dataRequirements: draft.dataRequirements,
                ...(esgEnabled
                  ? { sustainabilityImpact: draft.sustainabilityImpact }
                  : {}),
              }
            : kind === "use_case_ai"
              ? {
                  title: draft.title,
                  problem: draft.problem,
                  flowDescription: draft.flowDescription,
                  humanInTheLoop: draft.humanInTheLoop,
                  guardrails: draft.guardrails,
                  expectedImpact: draft.expectedImpact,
                  dataRequirements: draft.dataRequirements,
                  ...(esgEnabled
                    ? { sustainabilityImpact: draft.sustainabilityImpact }
                    : {}),
                  urgency: draft.urgency,
                }
              : {};

        const completed = Object.entries(fields)
          .filter(([, v]) => v != null && String(v).length > 0)
          .map(([k]) => k);

        const missing = Object.entries(fields)
          .filter(([, v]) => !v || String(v).length === 0)
          .map(([k]) => k);

        return {
          draftId: draft.id,
          kind,
          needsRouting: !kind,
          completed,
          missing,
          isComplete: !!kind && missing.length === 0,
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
  const raw = message.raw as Record<string, string | undefined>;
  // `team_id` (authed team) identifica l'installation owner: fondamentale per isolamento multi-tenant.
  const teamId = raw.team_id ?? raw.team ?? "";
  const threadTs = raw.thread_ts;
  const slackChannelId = raw.channel ?? "";
  const slackThreadRootTs = raw.thread_ts ?? raw.ts ?? "";

  const allMessages: Message[] = [];
  try {
    for await (const msg of thread.allMessages) {
      allMessages.push(msg);
    }
  } catch {
    allMessages.push(message);
  }

  const history = await toAiMessages(allMessages);
  const workspace = await getWorkspaceById(workspaceId);
  const esgEnabled = workspace?.esgEnabled === true;

  const tools = getUseCaseTools(
    workspaceId,
    slackUserId,
    teamId,
    threadTs,
    slackChannelId,
    slackThreadRootTs,
    esgEnabled
  );

  const result = streamText({
    model: anthropic("claude-sonnet-4-20250514"),
    system: buildSystemPrompt(esgEnabled),
    messages: history,
    tools,
    stopWhen: stepCountIs(15),
    onError: ({ error }) => {
      console.error("[slack/use-case-agent] streamText error:", error);
    },
  });

  try {
    // Un messaggio unico via chat.postMessage evita lo streaming nativo Slack
    // (chatStream / assistant) che richiede recipientUserId+teamId e può fallire
    // in silenzio su alcuni payload (es. canali privati) lasciando il thread muto.
    const text = (await result.text).trim();
    await thread.post(
      text.length > 0
        ? text
        : "Non sono riuscito a generare una risposta. Riprova con un messaggio più breve."
    );
  } catch (err) {
    console.error("[slack/use-case-agent] post reply failed:", err);
    try {
      await thread.post(
        "Si è verificato un errore tecnico. Riprova tra un momento; se il problema persiste, contatta l'admin."
      );
    } catch (postErr) {
      console.error("[slack/use-case-agent] fallback post failed:", postErr);
    }
  }
}
