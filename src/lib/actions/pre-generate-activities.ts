"use server";

import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { db } from "@/lib/db";
import { activities, uploadedDocuments } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";

const preGeneratedActivitySchema = z.object({
  activities: z.array(
    z.object({
      title: z.string(),
      description: z.string(),
      frequency: z.string().optional(),
      estimatedHoursWeek: z.number().optional(),
      workType: z
        .enum(["enrichment", "detection", "interpretation", "delivery"])
        .optional(),
      inputDescription: z.string().optional(),
      outputDescription: z.string().optional(),
      toolsUsed: z.array(z.string()).optional(),
      reasoning: z.string(),
    })
  ),
});

export type PreGeneratedActivity = z.infer<
  typeof preGeneratedActivitySchema
>["activities"][0];

export async function preGenerateActivitiesFromDocuments(
  workspaceId: string,
  departmentId: string
) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const docs = await db
    .select({
      fileName: uploadedDocuments.fileName,
      extractedText: uploadedDocuments.extractedText,
      summary: uploadedDocuments.summary,
    })
    .from(uploadedDocuments)
    .where(
      and(
        eq(uploadedDocuments.workspaceId, workspaceId),
        eq(uploadedDocuments.departmentId, departmentId)
      )
    );

  if (docs.length === 0) {
    return { activities: [] };
  }

  const documentContent = docs
    .map(
      (d) =>
        `### ${d.fileName}\n${d.extractedText?.slice(0, 20000) ?? d.summary ?? "[nessun contenuto]"}`
    )
    .join("\n\n---\n\n");

  const { object } = await generateObject({
    model: anthropic("claude-sonnet-4-20250514"),
    schema: preGeneratedActivitySchema,
    prompt: `Sei un esperto di process mining e analisi organizzativa. Analizza questi documenti relativi a una funzione aziendale e identifica le attività lavorative principali.

## DOCUMENTI
${documentContent}

## COSA FARE
Identifica le attività lavorative ricorrenti e strutturali descritte nei documenti. Per ogni attività:
1. **Titolo**: nome chiaro e conciso
2. **Descrizione**: cosa fa concretamente chi svolge questa attività
3. **Frequenza**: giornaliera, settimanale, mensile, ad_hoc
4. **Ore stimate**: quante ore/settimana stimate (se deducibile)
5. **Work type**: enrichment (portare dentro dati), detection (confrontare/classificare), interpretation (dati→decisioni), delivery (consegnare risultato)
6. **Input/Output**: cosa riceve e cosa produce
7. **Tools**: strumenti/software menzionati
8. **Reasoning**: perché hai identificato questa attività dai documenti

## REGOLE
- Identifica SOLO attività che emergono chiaramente dai documenti
- Non inventare attività generiche che non sono supportate dal testo
- Sii specifico: "Analisi mensile dei KPI di vendita" non "Analisi dati"
- Massimo 15 attività
- Se i documenti sono vaghi o non contengono informazioni su processi/attività, restituisci un array vuoto`,
  });

  return object;
}

export async function confirmPreGeneratedActivities(
  workspaceId: string,
  departmentId: string,
  confirmedActivities: PreGeneratedActivity[]
) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const saved = [];

  for (const act of confirmedActivities) {
    const [activity] = await db
      .insert(activities)
      .values({
        departmentId,
        workspaceId,
        title: act.title,
        description: act.description,
        frequency: act.frequency,
        timeSpentHoursWeek: act.estimatedHoursWeek,
        workType: act.workType,
        inputDescription: act.inputDescription,
        outputDescription: act.outputDescription,
        toolsUsed: act.toolsUsed,
      })
      .returning();
    saved.push(activity);
  }

  revalidatePath(`/dashboard/${workspaceId}/mapping/${departmentId}`);

  return { saved: saved.length };
}
