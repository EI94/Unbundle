import "server-only";
import { granolaCardState } from "@/lib/context/granola/view";
import { contextActorFor } from "@/lib/context/server/actor";
import { contextAbilities } from "@/lib/context/visibility";
import { readinessEmailChoice } from "@/lib/db/queries/ai-readiness-email";
import { getBellState } from "@/lib/db/queries/bell-state";
import { loadGranolaStatus } from "@/lib/db/queries/context-granola";
import { loadTeamMcpCard } from "@/lib/db/queries/team-mcp-tokens";
import { ucLsDomains } from "@/lib/db/queries/uc-access";
import { loadCliCard } from "@/lib/db/queries/use-case-cli-auth";
import { ensureDbSchema } from "@/lib/db/ensure-schema";
import { getAppUcExecutor } from "@/lib/db/uc-executor";
import { logSafeError } from "@/lib/log/safe-error";
import { isLateralSpaceEmail } from "@/lib/uc/lateral-space";
import { referentAskEnabled } from "@/lib/use-cases/referent/availability";
import { isUseCaseHubWorkspace } from "@/lib/use-cases/rollout";
import { canReviewWorkspacePortfolio } from "@/lib/workspace-permissions";
import { isCaseOnly } from "@/lib/auth/case-only";
import { referentEmailChoice, type AccountSheetData } from "./account";

/**
 * Le parti del foglio «Il tuo account» per chi guarda (rilascio 10, PROPOSTA-10 §3.10), lette quando il foglio si
 * apre e dopo ogni sua azione: le stesse letture e gli stessi controlli dei blocchi di Impostazioni da cui vengono
 * (la scelta sulle email della campanella, «Claude per il team», «CLI di Unbundle», Granola). Una parte che non si
 * legge resta fuori o dice di riprovare: il foglio non si ferma mai per una parte sola.
 */
export async function loadAccountSheet(i: {
  workspaceId: string;
  user: { id: string; email: string | null; emailVerified: boolean };
  role: string;
  env?: Readonly<Record<string, string | undefined>>;
}): Promise<AccountSheetData> {
  const env = i.env ?? process.env;
  const useCaseHub = isUseCaseHubWorkspace(i.workspaceId, env);
  const lateralSpace = isLateralSpaceEmail({ email: i.user.email, emailVerified: i.user.emailVerified === true }, ucLsDomains());
  const actor = contextActorFor(i.user, { role: i.role }, i.workspaceId);
  const readCli = () =>
    ensureDbSchema()
      .then(() => getAppUcExecutor())
      .then((executor) => loadCliCard(executor, { userId: i.user.id, workspaceId: i.workspaceId, lateralSpace }))
      .catch((error) => {
        logSafeError("account", "cli_non_letta", error, { workspaceId: i.workspaceId });
        return null;
      });

  // (8.0d) «Solo questo use case»: solo «Claude e terminale», con i collegamenti della sua CLI («CLI collegata ·
  // Scollega»). Niente del workspace: né le e-mail sulle richieste al referente, né il MCP del team, né Granola.
  if (isCaseOnly(i.role)) {
    const cli = await readCli();
    return { email: null, readinessEmail: null, claude: null, terminal: cli ? { links: cli.tokens } : null, granola: null };
  }

  const [bell, team, cli, granola, readinessEmail] = await Promise.all([
    getBellState(i.workspaceId, i.user.id).catch((error) => {
      logSafeError("account", "email_non_letta", error, { workspaceId: i.workspaceId });
      return null;
    }),
    // Decide da sé: area accesa e un ruolo da revisore; un errore diventa `status: "errore"`.
    loadTeamMcpCard({ workspaceId: i.workspaceId, user: i.user, role: i.role }),
    readCli(),
    contextAbilities(actor).canUseGranola ? loadGranolaStatus({ userId: i.user.id, workspaceId: i.workspaceId }) : Promise.resolve(null),
    // (0044) Solo a chi potrebbe ricevere le email dell'AI Readiness: decide da sé e non lancia mai.
    readinessEmailChoice({ workspaceId: i.workspaceId, userId: i.user.id, role: i.role }),
  ]);

  const email = bell
    ? referentEmailChoice({
        useCaseHub,
        reviewer: canReviewWorkspacePortfolio(i.role),
        askEnabled: referentAskEnabled(i.workspaceId, env),
        hasRequested: bell.hasRequested,
        on: bell.referentEmails,
      })
    : null;

  return {
    email: email?.shown ? { on: email.on } : null,
    readinessEmail,
    // Solo la parte personale: «Revoca tutti» e il conto dei token del workspace restano in Impostazioni › Collegamenti.
    claude: team
      ? {
          status: team.status,
          tokens: team.tokens,
          routeEnabled: team.routeEnabled,
          ttlDays: team.ttlDays,
          defaultLabel: team.defaultLabel,
          url: team.url,
          connectorName: team.connectorName,
          claudeCodeName: team.claudeCodeName,
          warningDays: team.warningDays,
          skillName: team.skillName,
        }
      : null,
    terminal: cli ? { links: cli.tokens } : null,
    granola: granola ? { state: granolaCardState(granola), accountEmail: granola.accountEmail, plan: granola.plan } : null,
  };
}
