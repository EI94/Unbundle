import "server-only";
/**
 * Le domande per il referente proposte dai coding agent, nella scheda dello use case (rilascio 8.0b,
 * RILASCIO-8.0b-COSTRUZIONE.md §7): le legge chi vede «Cosa serve»; le decide chi può aggiungere esigenze.
 *
 * - **Una decisione sola:** `claimAgentQuestion` passa la proposta da «proposta» a «aggiunta» o «scartata» con una
 *   condizione sullo stato; due persone che cliccano insieme non creano due esigenze. Se poi l'esigenza non nasce,
 *   `releaseAgentQuestion` la rimette «proposta».
 * - **Mai inviata da qui:** «Aggiungi a Cosa serve» crea un'esigenza «da chiedere» del cliente; al referente la
 *   manda una persona, con «Chiedi al referente», come sempre.
 * - Nessun nome di chi l'ha proposta nella scheda: si mostra solo il giorno.
 */
import type { UcExecutor } from "@/lib/db/uc-executor";
import { cast, toStatement, ucSql } from "@/lib/uc/sql/statement";

export interface AgentProposalView {
  id: string;
  question: string;
  reason: string | null;
  createdAt: string;
}

/** Le proposte da decidere di uno use case, dalla più recente (al massimo 30, il limite di chi propone). */
export async function listAgentProposals(executor: UcExecutor, input: { workspaceId: string; useCaseId: string }): Promise<AgentProposalView[]> {
  const [rows] = await executor.batch([
    toStatement(ucSql`SELECT id, question, reason, created_at FROM use_case_agent_questions
WHERE workspace_id = ${cast(input.workspaceId, "uuid")} AND use_case_id = ${cast(input.useCaseId, "uuid")} AND status = 'proposta'
ORDER BY created_at DESC LIMIT 30`),
  ]);
  return rows.map((r) => ({
    id: String(r.id),
    question: String(r.question),
    reason: r.reason === null || r.reason === undefined ? null : String(r.reason),
    createdAt: new Date(String(r.created_at)).toISOString(),
  }));
}

/** Decide una proposta ancora da decidere; null se non c'è più (decisa da qualcun altro, o di un altro use case). */
export async function claimAgentQuestion(
  executor: UcExecutor,
  input: { workspaceId: string; useCaseId: string; questionId: string; userId: string; decision: "aggiunta" | "scartata" },
): Promise<{ question: string; reason: string | null } | null> {
  const [rows] = await executor.batch([
    toStatement(ucSql`UPDATE use_case_agent_questions SET status = ${cast(input.decision, "text")}, decided_by_user_id = ${cast(input.userId, "uuid")}, decided_at = now()
WHERE id = ${cast(input.questionId, "uuid")} AND workspace_id = ${cast(input.workspaceId, "uuid")} AND use_case_id = ${cast(input.useCaseId, "uuid")} AND status = 'proposta'
RETURNING question, reason`),
  ]);
  const row = rows[0];
  if (!row) return null;
  return { question: String(row.question), reason: row.reason === null || row.reason === undefined ? null : String(row.reason) };
}

/** L'esigenza nata dalla proposta aggiunta. */
export async function linkAgentQuestionNeed(executor: UcExecutor, input: { workspaceId: string; questionId: string; needId: string }): Promise<void> {
  await executor.batch([
    toStatement(ucSql`UPDATE use_case_agent_questions SET need_id = ${cast(input.needId, "uuid")}
WHERE id = ${cast(input.questionId, "uuid")} AND workspace_id = ${cast(input.workspaceId, "uuid")} AND status = 'aggiunta'`),
  ]);
}

/** Se l'esigenza non è nata, la proposta torna da decidere. */
export async function releaseAgentQuestion(executor: UcExecutor, input: { workspaceId: string; questionId: string }): Promise<void> {
  await executor.batch([
    toStatement(ucSql`UPDATE use_case_agent_questions SET status = 'proposta', decided_by_user_id = NULL, decided_at = NULL
WHERE id = ${cast(input.questionId, "uuid")} AND workspace_id = ${cast(input.workspaceId, "uuid")} AND status = 'aggiunta' AND need_id IS NULL`),
  ]);
}

/** L'esigenza da creare per una proposta aggiunta: titolo entro 300 caratteri, il resto nel dettaglio. */
export function needFromProposal(input: { question: string; reason: string | null }): Record<string, unknown> {
  const full = input.question.trim();
  const title = full.length <= 300 ? full : `${full.slice(0, 299).trimEnd()}…`;
  const detail = [full.length > 300 ? full : null, input.reason ? `Perché: ${input.reason}` : null, "Proposta da un coding agent, aggiunta dal team."].filter(Boolean).join("\n\n");
  return { type: "requisito", kind: "altro", title, detail, ownerSide: "cliente" };
}
