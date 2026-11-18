"use server";

import { requireSession } from "@/lib/auth/redirect-to-login";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { strategicGoals } from "@/lib/db/schema";
import { getWorkspaceValueThesis } from "@/lib/db/queries/value-thesis";
import { getStrategicGoalsByWorkspace } from "@/lib/db/queries/workspaces";
import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { CLAUDE_MODEL, claudeCallSettings, throwIfRefused } from "@/lib/ai/models";
import { z } from "zod";
import { getCollaboratorAccess } from "@/lib/workspace-access";
import { canReviewWorkspacePortfolio } from "@/lib/workspace-permissions";

const GOAL_TYPES = ["goal", "objective", "key_result"] as const;
type GoalType = (typeof GOAL_TYPES)[number];

function isGoalType(value: unknown): value is GoalType {
  return typeof value === "string" && (GOAL_TYPES as readonly string[]).includes(value);
}

/**
 * Esito di «Salva» nel modulo di un obiettivo. Un rifiuto è un esito atteso e torna con il suo messaggio: un errore
 * lanciato porterebbe il modulo alla pagina d'errore, e in produzione il suo testo non arriva comunque al browser.
 */
export type GoalActionResult = { ok: true } | { ok: false; message: string };

export async function createGoalAction(formData: FormData): Promise<GoalActionResult> {
  const session = await requireSession();

  const workspaceId = formData.get("workspaceId") as string;
  const access = await getCollaboratorAccess(session.user.id, workspaceId);
  if (!access) return { ok: false, message: "Workspace non trovato." };
  // Gli obiettivi strategici del cliente li scrive solo chi rivede il portfolio, come per gli OKR suggeriti. La pagina
  // non mostra il modulo agli altri ruoli, ma può essere rimasta aperta da prima di un cambio di ruolo.
  if (!canReviewWorkspacePortfolio(access.role)) {
    return { ok: false, message: "Gli obiettivi li aggiunge chi valuta gli use case." };
  }
  const type = formData.get("type");
  if (!isGoalType(type)) return { ok: false, message: "Tipo di obiettivo non valido." };
  const title = formData.get("title") as string;
  const description = (formData.get("description") as string) || undefined;
  const parentId = (formData.get("parentId") as string) || undefined;
  // Il padre è un obiettivo di questo workspace: mai quello di un altro cliente.
  if (parentId) {
    const goals = await getStrategicGoalsByWorkspace(workspaceId);
    if (!goals.some((goal) => goal.id === parentId)) return { ok: false, message: "Obiettivo collegato non trovato: aggiorna la pagina." };
  }
  const direction = (formData.get("direction") as string) || undefined;
  const owner = (formData.get("owner") as string) || undefined;
  const timeframe = (formData.get("timeframe") as string) || undefined;
  const kpiName = (formData.get("kpiName") as string) || undefined;
  const kpiUnit = (formData.get("kpiUnit") as string) || undefined;
  const targetValue = formData.get("targetValue")
    ? Number(formData.get("targetValue"))
    : undefined;
  const currentValue = formData.get("currentValue")
    ? Number(formData.get("currentValue"))
    : undefined;

  await db.insert(strategicGoals).values({
    workspaceId,
    parentId: parentId || null,
    type,
    title,
    description,
    direction: direction as "increase" | "decrease" | "maintain" | undefined,
    owner,
    timeframe,
    kpiName,
    kpiUnit,
    targetValue,
    currentValue,
  });

  revalidatePath(`/dashboard/${workspaceId}/strategy`);
  return { ok: true };
}

export interface SuggestedOKR {
  type: "goal" | "objective" | "key_result";
  title: string;
  description: string;
  direction?: "increase" | "decrease" | "maintain";
  kpiName?: string;
  timeframe?: string;
}

export async function suggestOKRsAction(
  workspaceId: string
): Promise<SuggestedOKR[]> {
  const session = await requireSession();

  const access = await getCollaboratorAccess(session.user.id, workspaceId);
  if (!access) throw new Error("Workspace non trovato");
  if (!canReviewWorkspacePortfolio(access.role)) {
    throw new Error("Non hai i permessi per suggerire OKR.");
  }
  // (9a) La tesi del valore del workspace, non più quella dell'organizzazione.
  const thesis = await getWorkspaceValueThesis(workspaceId);
  if (!thesis) {
    throw new Error(
      "Completa prima la Discovery per avere la Value Thesis."
    );
  }

  const { object } = await throwIfRefused("actions/strategy", generateObject({
    model: anthropic(CLAUDE_MODEL),
    system: `Sei un esperto di strategia organizzativa. Data la Value Thesis di un'azienda, suggerisci un framework OKR (Objectives and Key Results) completo per guidare una trasformazione AI-driven.

Genera:
- 2-3 Goal di alto livello
- Per ogni Goal, 1-2 Objective
- Per ogni Objective, 2-3 Key Result misurabili

Focalizzati su:
- Obiettivi legati ai nodi strategici (dove il valore è differenziante)
- Riduzione costi/tempi nelle aree commodity
- Costruzione di nuove capability AI
- Mitigazione dei rischi chiave

Scrivi tutto in italiano. Sii concreto e specifico per questo business.`,
    messages: [
      {
        role: "user",
        content: `Value Thesis dell'azienda:\n${JSON.stringify(thesis, null, 2)}`,
      },
    ],
    schema: z.object({
      okrs: z.array(
        z.object({
          type: z.enum(["goal", "objective", "key_result"]),
          title: z.string(),
          description: z.string(),
          direction: z
            .enum(["increase", "decrease", "maintain"])
            .optional(),
          kpiName: z.string().optional(),
          timeframe: z.string().optional(),
        })
      ),
    }),
    ...claudeCallSettings("okrSuggestions"),
  }));

  return object.okrs;
}
