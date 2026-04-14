"use server";

import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getWorkspaceById } from "@/lib/db/queries/workspaces";
import { db } from "@/lib/db";
import { organizations, strategicGoals } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";

export async function createGoalAction(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const workspaceId = formData.get("workspaceId") as string;
  const type = formData.get("type") as "goal" | "objective" | "key_result";
  const title = formData.get("title") as string;
  const description = (formData.get("description") as string) || undefined;
  const parentId = (formData.get("parentId") as string) || undefined;
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
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const workspace = await getWorkspaceById(workspaceId);
  if (!workspace) throw new Error("Workspace non trovato");

  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, workspace.organizationId))
    .limit(1);

  const thesis = org?.companyValueThesis;
  if (!thesis) {
    throw new Error(
      "Completa prima la Discovery per avere la Value Thesis."
    );
  }

  const { object } = await generateObject({
    model: anthropic("claude-sonnet-4-20250514"),
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
  });

  return object.okrs;
}
