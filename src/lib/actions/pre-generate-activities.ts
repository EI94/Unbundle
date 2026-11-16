"use server";

import { requireWorkspaceAccess } from "@/lib/auth/require-workspace";
import { getDepartmentById } from "@/lib/db/queries/workspaces";
import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { CLAUDE_MODEL, MOTIVAZIONE_DESCRIPTION, claudeCallSettings, throwIfRefused } from "@/lib/ai/models";
import { z } from "zod";
import { db } from "@/lib/db";
import { activities, uploadedDocuments } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { contextActorFor } from "@/lib/context/server/actor";
import type { ContextActor } from "@/lib/context/visibility";
import { contextAiConsent } from "@/lib/db/queries/context-consent";
import { listContextSources } from "@/lib/db/queries/context-sources";
import { contextStoreReady } from "@/lib/db/queries/context-store";

/** Lo schema che il modello riempie: la motivazione ha un nome neutro (MOTIVAZIONE_DESCRIPTION in models.ts). */
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
      motivazione: z.string().describe(MOTIVAZIONE_DESCRIPTION),
    })
  ),
});

/** Un'attività proposta, per l'app: la motivazione torna in `reasoning`, come sempre. */
export type PreGeneratedActivity = Omit<
  z.infer<typeof preGeneratedActivitySchema>["activities"][0],
  "motivazione"
> & { reasoning: string };


/** Il reparto deve essere di questo workspace: l'id arriva dal client. */
async function requireDepartmentInWorkspace(workspaceId: string, departmentId: string) {
  const department = await getDepartmentById(departmentId);
  if (!department || department.workspaceId !== workspaceId) {
    throw new Error("Reparto non trovato in questo workspace.");
  }
}

/**
 * I documenti che chi chiama può mandare al modello (rilascio 9a, RILASCIO-9a-COSTRUZIONE.md §5.2): null vuol dire
 * tutti (Lateral Space; e senza la 0038, quando nessun documento è «Solo Lateral Space»). Per gli altri solo i
 * documenti «Per tutti» che vedono in «Contesto»: un documento interno non torna al cliente come attività.
 */
async function readableDocumentIds(actor: ContextActor): Promise<Set<string> | null> {
  if (actor.isLateralSpace || !(await contextStoreReady())) return null;
  const sources = await listContextSources(actor, { limit: 500 });
  return new Set(sources.flatMap((source) => (source.document ? [source.document.id] : [])));
}

/** L'esito: le attività proposte; `consentMissing` quando il workspace non ha l'ok ai fornitori di AI. */
export type PreGeneratedActivities = { activities: PreGeneratedActivity[]; consentMissing?: true };

export async function preGenerateActivitiesFromDocuments(
  workspaceId: string,
  departmentId: string
): Promise<PreGeneratedActivities> {
  const { session, access } = await requireWorkspaceAccess(workspaceId);
  await requireDepartmentInWorkspace(workspaceId, departmentId);

  // L'ok ai sub-responsabili (rilascio 9a, RILASCIO-9a-COSTRUZIONE.md §6.2): senza, nessun testo dei documenti va al modello.
  if (!(await contextAiConsent(workspaceId))) {
    return { activities: [], consentMissing: true };
  }
  const actor = contextActorFor(
    { id: session.user.id, email: session.user.email ?? null, emailVerified: session.user.emailVerified === true },
    access,
    workspaceId
  );

  const unitDocs = await db
    .select({
      id: uploadedDocuments.id,
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
  const readable = await readableDocumentIds(actor);
  const docs = readable ? unitDocs.filter((doc) => readable.has(doc.id)) : unitDocs;

  if (docs.length === 0) {
    return { activities: [] };
  }

  const documentContent = docs
    .map(
      (d) =>
        `### ${d.fileName}\n${d.extractedText?.slice(0, 20000) ?? d.summary ?? "[nessun contenuto]"}`
    )
    .join("\n\n---\n\n");

  const { object } = await throwIfRefused("actions/pre-generate-activities", generateObject({
    model: anthropic(CLAUDE_MODEL),
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
8. **Motivazione**: in una o due frasi, perché questa attività emerge dai documenti

## REGOLE
- Identifica SOLO attività che emergono chiaramente dai documenti
- Non inventare attività generiche che non sono supportate dal testo
- Sii specifico: "Analisi mensile dei KPI di vendita" non "Analisi dati"
- Massimo 15 attività
- Se i documenti sono vaghi o non contengono informazioni su processi/attività, restituisci un array vuoto`,
    ...claudeCallSettings("preGenerateActivities"),
  }));

  return {
    activities: object.activities.map(({ motivazione, ...activity }): PreGeneratedActivity => ({ ...activity, reasoning: motivazione })),
  };
}

export async function confirmPreGeneratedActivities(
  workspaceId: string,
  departmentId: string,
  confirmedActivities: PreGeneratedActivity[]
) {
  await requireWorkspaceAccess(workspaceId);
  await requireDepartmentInWorkspace(workspaceId, departmentId);

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
