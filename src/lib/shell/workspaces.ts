/**
 * `/dashboard` · I tuoi workspace (rilascio 10, ondata 2a «Cornice», docs/ui-10/PROPOSTA-10.md §3.2, D1): chi ha un
 * solo workspace entra diretto; resta sull'elenco chi lo chiede («Tutti i workspace», «Nuovo workspace» dal selettore)
 * e chi arriva con un avviso da leggere (workspace eliminato, errore di Slack, Granola). Modulo puro.
 */
import { SHELL_TEXT } from "./text.ts";

/** I parametri con cui l'elenco resta in vista anche con un solo workspace. */
export const PICKER_STAY_PARAMS = Object.freeze(["tutti", "nuovo", "workspaceDeleted", "slack_error", "granola"] as const);

type Search = Readonly<Record<string, string | string[] | undefined>>;

const present = (value: string | string[] | undefined) => (Array.isArray(value) ? value.length > 0 : typeof value === "string" && value.trim() !== "");

/** Il workspace in cui entrare diretti, oppure null (zero o più workspace, o l'elenco chiesto). */
export function directWorkspaceId(groups: ReadonlyArray<{ workspaces: ReadonlyArray<{ workspace: { id: string } }> }>, search: Search = {}): string | null {
  const ids = [...new Set(groups.flatMap((group) => group.workspaces.map((entry) => entry.workspace.id)))];
  if (ids.length !== 1) return null;
  return PICKER_STAY_PARAMS.some((key) => present(search[key])) ? null : ids[0];
}

/** La creazione chiesta dal selettore («Nuovo workspace»): il dialogo si apre da solo. */
export const wantsNewWorkspace = (search: Search) => search.nuovo === "1";

const SLACK_ERRORS: Readonly<Record<string, string>> = Object.freeze({
  invalid_workspace: SHELL_TEXT.picker.slackInvalidWorkspace,
  forbidden: SHELL_TEXT.picker.slackForbidden,
});

/** (Ondata 0) L'errore di Slack in parole: una frase, mai la chiave dell'errore. Vuoto senza errore. */
export function slackErrorMessage(key: string | undefined): string {
  const trimmed = key?.trim() ?? "";
  if (!trimmed) return "";
  return Object.hasOwn(SLACK_ERRORS, trimmed) ? SLACK_ERRORS[trimmed] : SHELL_TEXT.picker.slackOther;
}
