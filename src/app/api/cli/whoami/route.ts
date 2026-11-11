import { cast, toStatement, ucSql } from "@/lib/uc/sql/statement";
import { cliJson, openCli } from "@/lib/use-cases/cli/route-kit";

/**
 * `unbundle whoami` (rilascio 8.0b): chi è il token. Il nome della persona, il workspace, il ruolo nel workspace,
 * il caso per un token di un caso solo, la scadenza. Mai l'indirizzo e-mail.
 */
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const opened = await openCli(request, { method: "GET", write: false });
  if (!opened.ok) return opened.response;
  const { principal, access, executor } = opened.value;
  const [people, cases] = await executor.batch([
    toStatement(ucSql`SELECT name FROM users WHERE id = ${cast(principal.userId, "uuid")}`),
    toStatement(ucSql`SELECT code FROM use_cases WHERE id = ${cast(principal.caseUseCaseId, "uuid")} AND workspace_id = ${cast(principal.workspaceId, "uuid")}`),
  ]);
  return cliJson({
    persona: { nome: people[0]?.name ? String(people[0].name) : null },
    workspace: { id: access.workspace.id, nome: access.workspace.name },
    ruolo: access.role,
    caso: cases[0]?.code ? String(cases[0].code) : null,
    scade: principal.expiresAt,
  });
}
