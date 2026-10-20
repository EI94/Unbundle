/**
 * Dipendenze dell'app per la rotta del connettore (prompt WP5): ingresso e limite di
 * `app-deps.ts`, letture dei tool su Postgres (`tool-queries.ts` con il client Neon
 * condiviso, dopo il self-heal), servizio condiviso di invio con le stesse
 * dipendenze della REST. Il profilo del cliente e il modello delle istruzioni arrivano con
 * la configurazione del workspace (`workspace_connector_configs`, decisione 1 dell'arresto B):
 * nessuna variabile d'ambiente, nessun valore d'esempio.
 * I dossier dei Casi d'uso (`linked-case.ts`) si leggono solo con `UC_ENABLED=true`
 * nell'ambiente, controllato a ogni chiamata.
 *
 * La rotta passa lo scheduler (`after()` di Next): auto-ranking e notifiche partono
 * dopo la risposta. I test d'integrazione usano queste stesse dipendenze sul
 * database locale, con ranking, notifiche e Slack finti.
 */
import { appSubmitContributionDeps } from "@/lib/portfolio/submission-http";
import type { AfterResponseScheduler, SubmitContributionDeps } from "@/lib/portfolio/submit-contribution";
import { appConnectorGateDeps, appRateLimitExecutor } from "./app-deps";
import type { ExposedTokenAlertDeps } from "./exposed-token-alert";
import type { ConnectorHandlerDeps } from "./handler";
import { linkedCaseCodeOf, ucCasesEnabled, type LinkedCaseOptions } from "./linked-case";
import type { SqlExecutor } from "./rate-limit";
import {
  contributionStatusByCode,
  findCompletedSubmissionUseCaseId,
  recentContributionsOfIdentity,
  relatedCodeExists,
  searchContributions,
} from "./tool-queries";
import type { ConnectorToolDeps } from "./tools";

/**
 * Letture dei tool e limite, con un esecutore SQL (nell'app quello del limite, dopo il
 * self-heal). `env` decide se si leggono i dossier dei Casi d'uso (`UC_ENABLED`).
 */
export function connectorToolDepsFor(
  exec: SqlExecutor,
  opts: { schedule: AfterResponseScheduler; submit?: SubmitContributionDeps; env?: Readonly<Record<string, string | undefined>> }
): ConnectorToolDeps {
  const env = opts.env ?? process.env;
  const cases = (): LinkedCaseOptions => ({ enabled: ucCasesEnabled(env) });
  return {
    rateLimitExec: exec,
    relatedCodeExists: (workspaceId, code) => relatedCodeExists(exec, workspaceId, code),
    findCompletedSubmission: (params) => findCompletedSubmissionUseCaseId(exec, params),
    searchContributions: (params) => searchContributions(exec, params, cases()),
    contributionStatusByCode: (params) => contributionStatusByCode(exec, params, cases()),
    recentContributionsOfIdentity: (params) => recentContributionsOfIdentity(exec, params, cases()),
    linkedCaseCode: (params) => linkedCaseCodeOf(exec, params, cases()),
    submit: opts.submit ?? appSubmitContributionDeps,
    schedule: opts.schedule,
  };
}

/** Tutte le dipendenze della rotta; l'ambiente è quello del processo. */
export function appConnectorHandlerDeps(opts: {
  schedule: AfterResponseScheduler;
  env?: Readonly<Record<string, string | undefined>>;
  submit?: SubmitContributionDeps;
  alertDeps?: ExposedTokenAlertDeps;
}): ConnectorHandlerDeps {
  const env = opts.env ?? process.env;
  return {
    gate: opts.alertDeps ? appConnectorGateDeps(env, opts.alertDeps) : appConnectorGateDeps(env),
    tools: connectorToolDepsFor(appRateLimitExecutor, { schedule: opts.schedule, submit: opts.submit, env }),
  };
}
