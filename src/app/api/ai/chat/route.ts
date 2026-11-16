import { streamText, stepCountIs } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { auth } from "@/lib/auth";
import { getCollaboratorAccess } from "@/lib/workspace-access";
import { getLeadershipTools } from "@/lib/ai/tools/leadership-tools";
import { getActivityMappingTools } from "@/lib/ai/tools/activity-mapping-tools";
import { getWebSearchTool } from "@/lib/ai/tools/web-search-tool";
import { DISCOVERY_SYSTEM_PROMPT } from "@/lib/ai/prompts/discovery";
import { ACTIVITY_MAPPING_SYSTEM_PROMPT } from "@/lib/ai/prompts/activity-mapping";
import { withAgentReliability } from "@/lib/ai/agent-reliability";
import { chatHistory, closingQuestions, refusedQuestionIds } from "@/lib/ai/chat-history";
import {
  CLAUDE_MODEL,
  chatDeadline,
  chatToolsDeadline,
  claudeCallSettings,
  lastStepRefused,
  logClaudeStop,
  stopAtDeadline,
} from "@/lib/ai/models";
import { logSafeError } from "@/lib/log/safe-error";
import {
  saveMessage,
  deleteMessage,
  getMessages,
  getActiveConversation,
  createConversation,
} from "@/lib/db/queries/conversations";
import { db } from "@/lib/db";
import { uploadedDocuments, activities } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getWorkspaceValueThesis } from "@/lib/db/queries/value-thesis";
import { getDepartmentById } from "@/lib/db/queries/workspaces";
import { isUuid } from "@/lib/uc/ids";
import { retrieveRelevantContext, indexConversationMessage } from "@/lib/ai/rag/retriever";
import { contextAiConsent } from "@/lib/db/queries/context-consent";
import { CONTEXT_TEXT } from "@/lib/context/text";

/** Vercel / Next: consenti più round LLM dopo i tool (webSearch, salvataggi DB, ecc.) */
export const maxDuration = 120;

export async function POST(req: Request) {
  // Due scadenze per la richiesta, dal suo inizio (src/lib/ai/models.ts). I tool che chiamano il modello (ricerca web,
  // classificazione e match O*NET) si fermano alla loro, 20 secondi prima di quella del giro: dopo un tool fermato lì il
  // modello ha ancora un passo per rispondere. Dalla scadenza del giro nessun nuovo passo comincia (stopWhen qui sotto),
  // e il passo in corso ha il resto di maxDuration per finire.
  const startedAt = Date.now();
  const loopDeadline = chatDeadline(startedAt, maxDuration);
  const toolsDeadline = chatToolsDeadline(startedAt, maxDuration);
  const session = await auth();
  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  const body = await req.json();
  const workspaceId = body.workspaceId as string;
  const conversationType = body.conversationType as string;
  const departmentId = body.departmentId as string | undefined;
  const rawMessages = body.messages as Array<Record<string, unknown>>;

  if (!workspaceId || !conversationType || !rawMessages) {
    return new Response("Missing required fields", { status: 400 });
  }

  const access = await getCollaboratorAccess(session.user.id, workspaceId);
  if (!access) {
    return new Response("Workspace not found", { status: 404 });
  }
  const { workspace } = access;
  // L'unità arriva dal browser (rilascio 9a, RILASCIO-9a-COSTRUZIONE.md §10.5): deve essere di questo workspace, prima
  // di tutto. Con l'id di un'unità di un altro workspace i tool della mappatura scriverebbero lì. La mappatura la vuole.
  if (departmentId !== undefined || conversationType === "activity_mapping") {
    const unit = typeof departmentId === "string" && isUuid(departmentId) ? await getDepartmentById(departmentId) : null;
    if (!unit || unit.workspaceId !== workspaceId) {
      return new Response("Department not found", { status: 404 });
    }
  }
  // L'ok ai sub-responsabili (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md §6.2): senza, nessun testo del
  // cliente va al modello e niente si salva. La chat mostra l'avviso al posto del campo per scrivere
  // (src/components/agent/chat-consent.ts); i messaggi di prima restano.
  if (!(await contextAiConsent(workspaceId))) {
    return Response.json({ error: "ok_fornitori_mancante", message: CONTEXT_TEXT.consent.title }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  // «Programma» (rilascio 7): dipendenti e ricavo dalla chat li scrive solo chi li scriverebbe nella pagina.
  const { canEditProgram } = await import("@/lib/db/queries/use-case-program");
  const { viewerFromSession } = await import("@/lib/db/queries/use-case-hub");
  const canSaveCompanyFacts = canEditProgram({
    role: access.role,
    isLateralSpace: viewerFromSession({ id: session.user.id, email: session.user.email, emailVerified: session.user.emailVerified === true }, access.role).isLateralSpace,
  });

  // Solo turni `user`/`assistant` con del testo, dal primo turno dell'utente: il benvenuto dell'interfaccia
  // non va al modello (src/lib/ai/chat-history.ts). L'ultimo turno è dell'utente: un turno finale
  // dell'assistente sarebbe un prefill, che il modello rifiuta con un 400.
  const messages = chatHistory(Array.isArray(rawMessages) ? rawMessages : []);
  if (messages[messages.length - 1]?.role !== "user") {
    return new Response("Missing required fields", { status: 400 });
  }

  // La tesi del valore sta sul workspace (rilascio 9a, RILASCIO-9a-COSTRUZIONE.md §10.1): mai quella di un altro
  // workspace della stessa organizzazione.
  const valueThesis = await getWorkspaceValueThesis(workspaceId);

  let contextBlock = "";

  const unitTerm = (workspace.unitTerminology as { singular: string; plural: string } | null);
  if (unitTerm?.singular) {
    contextBlock += `\n\n--- TERMINOLOGIA ORGANIZZATIVA ---\nL'utente chiama le proprie unità organizzative "${unitTerm.plural}" (singolare: "${unitTerm.singular}"). Usa SEMPRE questi termini, MAI "dipartimento" o "funzione" generici.\n`;
  }

  if (valueThesis) {
    contextBlock += `\n--- CONTESTO: VALUE THESIS GIÀ RACCOLTA ---\n${JSON.stringify(valueThesis, null, 2)}\n`;
  }

  if (workspace.systemBoundary) {
    contextBlock += `\n--- CONTESTO: SYSTEM BOUNDARY ---\n${JSON.stringify(workspace.systemBoundary, null, 2)}\n`;
  }

  const lastUserContent = messages[messages.length - 1]?.content ?? "";
  let ragChunks: { content: string; source: string }[] = [];
  try {
    if (lastUserContent.length > 10) {
      ragChunks = await retrieveRelevantContext(lastUserContent, workspaceId, {
        topK: 8,
        includeConversations: true,
      });
    }
  } catch {
    // RAG fallback: se embedding non disponibile, carica doc summaries
  }

  if (ragChunks.length > 0) {
    const docChunks = ragChunks.filter((c) => c.source === "document");
    const convChunks = ragChunks.filter((c) => c.source === "conversation");

    if (docChunks.length > 0) {
      contextBlock += `\n--- CONTESTO RILEVANTE DAI DOCUMENTI (${docChunks.length} frammenti) ---\n`;
      for (const chunk of docChunks) {
        contextBlock += `\n${chunk.content}\n`;
      }
    }
    if (convChunks.length > 0) {
      contextBlock += `\n--- MEMORIA DA CONVERSAZIONI PRECEDENTI (${convChunks.length} frammenti) ---\n`;
      for (const chunk of convChunks) {
        contextBlock += `\n${chunk.content}\n`;
      }
    }
    contextBlock += `\nUsa queste informazioni per arricchire le tue risposte. Fai riferimento a contenuti specifici quando pertinente.\n`;
  } else {
    const docs = await db
      .select({ fileName: uploadedDocuments.fileName, summary: uploadedDocuments.summary })
      .from(uploadedDocuments)
      .where(eq(uploadedDocuments.workspaceId, workspaceId));

    if (docs.length > 0) {
      contextBlock += `\n--- DOCUMENTI CARICATI DALL'UTENTE (${docs.length}) ---\n`;
      for (const doc of docs) {
        contextBlock += `\nDocumento: ${doc.fileName}\n`;
        if (doc.summary) contextBlock += `Sintesi: ${doc.summary}\n`;
      }
      contextBlock += `\nUsa queste informazioni per arricchire le tue domande e risposte. Fai riferimento ai documenti quando pertinente.\n`;
    }
  }

  let systemPrompt: string;
  let tools: Record<string, unknown>;

  switch (conversationType) {
    case "leadership_setup":
      systemPrompt = DISCOVERY_SYSTEM_PROMPT + contextBlock;
      tools = {
        ...getLeadershipTools(workspaceId, workspace.organizationId, { canSaveCompanyFacts }),
        ...getWebSearchTool({ deadline: toolsDeadline }),
      };
      break;
    case "activity_mapping": {
      let mappingContext = contextBlock;

      if (departmentId) {
        const existingActivities = await db
          .select({
            id: activities.id,
            title: activities.title,
            description: activities.description,
            workType: activities.workType,
            timeSpentHoursWeek: activities.timeSpentHoursWeek,
          })
          .from(activities)
          .where(
            and(
              eq(activities.workspaceId, workspaceId),
              eq(activities.departmentId, departmentId)
            )
          );

        if (existingActivities.length > 0) {
          mappingContext += `\n--- ATTIVITÀ GIÀ SALVATE PER QUESTO DIPARTIMENTO (${existingActivities.length}) ---\n`;
          for (const act of existingActivities) {
            mappingContext += `- [${act.id}] "${act.title}" (${act.workType ?? "non classificata"}): ${act.description ?? ""}\n`;
          }
          mappingContext += `\nQueste attività sono già nel database. NON ri-salvarle. Usale come base per il deep dive.\n`;
        }

        const deptDocs = await db
          .select({
            fileName: uploadedDocuments.fileName,
            summary: uploadedDocuments.summary,
          })
          .from(uploadedDocuments)
          .where(
            and(
              eq(uploadedDocuments.workspaceId, workspaceId),
              eq(uploadedDocuments.departmentId, departmentId)
            )
          );

        if (deptDocs.length > 0) {
          mappingContext += `\n--- DOCUMENTI SPECIFICI (${deptDocs.length}) ---\n`;
          for (const doc of deptDocs) {
            mappingContext += `\nDocumento: ${doc.fileName}\n`;
            if (doc.summary) mappingContext += `Sintesi: ${doc.summary}\n`;
          }
          mappingContext += `\nI contenuti dettagliati dei documenti sono già inclusi nel contesto RAG sopra, in base alla rilevanza con la domanda dell'utente.\n`;
        }
      }

      systemPrompt = ACTIVITY_MAPPING_SYSTEM_PROMPT + mappingContext;
      tools = {
        ...getActivityMappingTools(workspaceId, departmentId!, { deadline: toolsDeadline }),
        ...getWebSearchTool({ deadline: toolsDeadline }),
      };
      break;
    }
    default:
      systemPrompt = DISCOVERY_SYSTEM_PROMPT + contextBlock;
      tools = {
        ...getLeadershipTools(workspaceId, workspace.organizationId, { canSaveCompanyFacts }),
        ...getWebSearchTool({ deadline: toolsDeadline }),
      };
  }

  let conversation = await getActiveConversation(
    workspaceId,
    conversationType as
      | "leadership_setup"
      | "context_setup"
      | "activity_mapping"
      | "analysis"
      | "general",
    departmentId
  );

  if (!conversation) {
    conversation = await createConversation({
      workspaceId,
      userId: session.user.id,
      type: conversationType as
        | "leadership_setup"
        | "context_setup"
        | "activity_mapping"
        | "analysis"
        | "general",
      departmentId,
      title:
        conversationType === "leadership_setup"
          ? "Discovery"
          : conversationType === "activity_mapping"
            ? "Activity Mapping"
            : "Conversazione",
    });
  }

  // La domanda si salva prima della chiamata, così resta anche se il turno si interrompe; se il modello la
  // rifiuta, si toglie (onFinish qui sotto).
  const lastUserMessage = messages[messages.length - 1];
  let savedQuestion: { id: string } | undefined;
  if (lastUserMessage?.role === "user" && lastUserMessage.content) {
    savedQuestion = await saveMessage({
      conversationId: conversation.id,
      role: "user",
      content: lastUserMessage.content,
    });
  }

  const result = streamText({
    model: anthropic(CLAUDE_MODEL),
    system: withAgentReliability(systemPrompt),
    messages,
    tools: tools as Parameters<typeof streamText>[0]["tools"],
    // Default SDK = stepCountIs(1): dopo un tool call lo stream si chiude SENZA secondo round
    // → UI bloccata su "Elaboro...". Serve un budget di step per testo post-tool.
    // Un passo rifiutato chiude il giro (src/lib/ai/models.ts): il turno resta un rifiuto, anche con un tool non valido.
    // Dalla scadenza del giro nessun nuovo passo comincia: il turno si chiude dentro maxDuration, senza interrompere lo stream.
    stopWhen: [stepCountIs(20), lastStepRefused, stopAtDeadline("chat/route", loopDeadline)],
    onError: ({ error }) => {
      console.error("[chat/route] streamText error:", error);
    },
    onFinish: async ({ text, finishReason, providerMetadata }) => {
      // Un rifiuto dei classificatori del modello non è una risposta: l'eventuale testo parziale
      // non si salva, e il turno (domanda compresa) non entra nella memoria della chat. La domanda
      // esce anche dai messaggi salvati, come dalla storia del browser (chat-view.ts): ricaricando la
      // pagina non tornerebbe al modello unita alla domanda dopo. Con lei escono le domande dei turni
      // interrotti subito prima, che il modello ha ricevuto unite a lei: riconosciute dal testo, perché
      // tra loro può esserci la domanda di un'altra persona del workspace (chat-history.ts).
      if (finishReason === "content-filter") {
        logClaudeStop("chat/route", "risposta_rifiutata", { finishReason, providerMetadata });
        if (savedQuestion) {
          const question = savedQuestion;
          const closing = closingQuestions(messages);
          try {
            const refused = closing.length > 1 ? refusedQuestionIds(await getMessages(conversation.id), question.id, closing) : [question.id];
            for (const id of refused) await deleteMessage(conversation.id, id);
          } catch (error) {
            logSafeError("chat/route", "domanda_rifiutata_non_tolta", error);
          }
        }
        return;
      }
      if (text) {
        await saveMessage({
          conversationId: conversation.id,
          role: "assistant",
          content: text,
        });

        indexConversationMessage(
          conversation.id,
          workspaceId,
          text,
          "assistant"
        ).catch(() => {});
      }

      if (lastUserMessage?.content) {
        indexConversationMessage(
          conversation.id,
          workspaceId,
          lastUserMessage.content,
          "user"
        ).catch(() => {});
      }
    },
    // Sforzo medio, 16000 token per passo, senza ripiego lato server, con le note tra i tool (src/lib/ai/models.ts).
    // Per ultime: niente scritto qui le sostituisce.
    ...claudeCallSettings("chat"),
  });

  // Il perché della fine arriva al browser (src/components/agent/chat-view.ts): una risposta rifiutata
  // si mostra come avviso e non torna al modello nel turno dopo.
  return result.toUIMessageStreamResponse({
    messageMetadata: ({ part }) => (part.type === "finish" ? { finishReason: part.finishReason } : undefined),
  });
}
