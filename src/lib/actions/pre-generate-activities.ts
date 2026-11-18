"use server";

import { randomUUID } from "node:crypto";
import { requireWorkspaceAccess } from "@/lib/auth/require-workspace";
import { getDepartmentById } from "@/lib/db/queries/workspaces";
import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { CLAUDE_MODEL, MOTIVAZIONE_DESCRIPTION, claudeCallSettings, throwIfRefused } from "@/lib/ai/models";
import { z } from "zod";
import { db } from "@/lib/db";
import { uploadedDocuments } from "@/lib/db/schema";
import { getAppUcExecutor } from "@/lib/db/uc-executor";
import { eq, and } from "drizzle-orm";
import { contextActorFor } from "@/lib/context/server/actor";
import type { ContextActor } from "@/lib/context/visibility";
import { contextAiConsent } from "@/lib/db/queries/context-consent";
import { listContextSources } from "@/lib/db/queries/context-sources";
import { loadPromptContext } from "@/lib/db/queries/context-work";
import { contextStoreState } from "@/lib/db/queries/context-store";
import { opsForNewStep, type BoardOp } from "@/lib/mappatura/board-ops";
import { resolveProcess, saveBoardOps } from "@/lib/mappatura/board-store";

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


/**
 * Quante attività propone al più la lettura dei documenti, e quanti passi si confermano al più in una volta. Il prompt
 * chiede «Massimo 15», ma lo schema del modello non ha un massimo: le proposte oltre la quindicesima non arrivano al
 * browser, e una lista più lunga che torna dal browser si salva nei suoi primi 15 passi (i testi si tagliano, non si
 * rifiutano). (In un file «use server» solo funzioni esportate.)
 */
const MAX_PROPOSED_ACTIVITIES = 15;

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
 * documenti «Per tutti» che vedono in «Contesto»: un documento interno non torna al cliente come attività. Se la sonda
 * della 0038 non risponde non si sa quali sono interni: nessuno (si chiude, non si apre).
 */
async function readableDocumentIds(actor: ContextActor): Promise<Set<string> | null> {
  if (actor.isLateralSpace) return null;
  const store = await contextStoreState();
  if (store === "assente") return null;
  if (store === "sconosciuto") return new Set();
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
  // (Rilascio 9b, docs/contesto/RILASCIO-9b-COSTRUZIONE.md §2.12) Il blocco «Contesto» («In breve» e i fatti «Per tutti»
  // su lavoro e sistemi, per chiunque chieda), dopo i documenti e prima delle richieste.
  const contesto = await loadPromptContext(workspaceId, { profile: "activities", consent: "request" });

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
${contesto}
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
    activities: object.activities.slice(0, MAX_PROPOSED_ACTIVITIES).map(({ motivazione, ...activity }): PreGeneratedActivity => ({ ...activity, reasoning: motivazione })),
  };
}

/** Un testo che arriva dal browser: si taglia ai limiti della board quando si scrive, qui si guarda solo la forma. */
const raw = z.string().max(20_000);
/**
 * (Mappatura board) La lista che torna dal browser, già tagliata ai suoi primi 15 passi: ognuno con la forma di una
 * proposta. I testi si tagliano ai limiti della board (`opsForNewStep`), come per l'assistente: niente oltre i limiti
 * arriva al database.
 */
const confirmedSchema = z
  .array(
    z.object({
      title: raw,
      description: raw.optional(),
      frequency: raw.optional(),
      estimatedHoursWeek: z.number().finite().optional(),
      workType: z.enum(["enrichment", "detection", "interpretation", "delivery"]).optional(),
      inputDescription: raw.optional(),
      outputDescription: raw.optional(),
      toolsUsed: z.array(raw).max(200).optional(),
    }),
  )
  .max(MAX_PROPOSED_ACTIVITIES);

/**
 * Le attività scelte tra quelle proposte dai documenti diventano passi della board, nel primo processo dell'unità, «da
 * validare» e venuti dai documenti: una sola scrittura, con `saveBoardOps` (lo scope dell'unità controllata in ogni
 * istruzione). Restituisce quanti passi sono entrati.
 */
export async function confirmPreGeneratedActivities(
  workspaceId: string,
  departmentId: string,
  confirmedActivities: PreGeneratedActivity[]
) {
  const { session, access } = await requireWorkspaceAccess(workspaceId);
  await requireDepartmentInWorkspace(workspaceId, departmentId);

  // Oltre il quindicesimo i passi restano fuori, come le proposte oltre la quindicesima: non si rifiuta tutto.
  const firstFifteen: unknown = Array.isArray(confirmedActivities) ? confirmedActivities.slice(0, MAX_PROPOSED_ACTIVITIES) : confirmedActivities;
  const parsed = confirmedSchema.safeParse(firstFifteen);
  if (!parsed.success) throw new Error("Passi non validi.");
  if (parsed.data.length === 0) return { saved: 0 };

  const executor = await getAppUcExecutor();
  const scope = { workspaceId, departmentId };
  const processId = await resolveProcess(executor, scope, null);
  if (!processId) throw new Error("La board non è ancora disponibile.");

  const ops: BoardOp[] = [];
  const adds: string[] = [];
  for (const act of parsed.data) {
    const step = opsForNewStep(
      {
        title: act.title,
        description: act.description,
        frequency: act.frequency,
        hoursWeek: act.estimatedHoursWeek,
        workType: act.workType,
        input: act.inputDescription,
        output: act.outputDescription,
        tools: act.toolsUsed,
      },
      { processId },
      () => randomUUID(),
    );
    if (step.ops.length === 0) continue;
    adds.push(step.ops[0].id);
    ops.push(...step.ops);
  }
  if (ops.length === 0) return { saved: 0 };

  const result = await saveBoardOps(executor, scope, { kind: "documenti", userId: session.user.id, role: access.role }, { baseRevision: 0, ops });
  if (!result.ok) throw new Error(result.code === "non_disponibile" ? "La board non è ancora disponibile." : "Passi non salvati.");
  const refused = new Set(result.rejected.map((rejection) => rejection.id));
  return { saved: adds.filter((id) => !refused.has(id)).length };
}
