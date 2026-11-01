/**
 * Gli avvisi alle persone del cliente (release «notifiche»): l'interruttore
 * `USE_CASE_CLIENT_NOTICES`, spento ovunque finché il proprietario non lo accende per un workspace.
 *
 * Oggi l'unico avviso al cliente è «Autorizza i fornitori» (riga nella campanella ed email a chi può
 * dare l'«ok sui sub-responsabili»). Con l'interruttore spento non si scrive e non si manda niente a
 * nessuno. «Pronto da avviare» va solo a Lateral Space e non passa da qui (`readyNoticesEnabled`).
 *
 * `USE_CASE_CLIENT_NOTICES`:
 * - un elenco di UUID di workspace separati da virgole: avvisi accesi solo per quelli;
 * - `*` **non** accende niente, di proposito: ogni cliente si accende uno per uno;
 * - le voci che non sono UUID interi (errori di battitura, «true», «all») si ignorano;
 * - vuota o assente: spenti ovunque.
 * In più servono le condizioni di «Chiedi al referente» (`referentAskEnabled`): area «Use case»
 * accesa per il workspace e non esclusa, `USE_CASE_REFERENTS` diverso da `off`, mai in
 * un'anteprima di Vercel (le anteprime usano il database di produzione).
 *
 * Come si accende (RUNBOOK §10.8): Vercel › Settings › Environment Variables › Production,
 * `USE_CASE_CLIENT_NOTICES=<uuid del workspace>[,<uuid>…]`, poi un nuovo deploy; controllo con
 * `use-case-admin doctor --workspace <uuid>` (`avvisiCliente: true`). Si spegne togliendo l'UUID e
 * rifacendo il deploy: le email in coda si annullano all'invio.
 *
 * Modulo puro: le variabili arrivano come parametro.
 */
import { referentAskEnabled } from "./referent/availability.ts";
import { isUseCaseHubWorkspace } from "./rollout.ts";

type Env = Readonly<Record<string, string | undefined>>;

export const USE_CASE_CLIENT_NOTICES_ENV = "USE_CASE_CLIENT_NOTICES";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Gli UUID dell'elenco, in minuscolo; `*` e le voci che non sono UUID non contano. */
export function clientNoticeWorkspaceIds(env: Env): ReadonlySet<string> {
  const out = new Set<string>();
  for (const item of (env[USE_CASE_CLIENT_NOTICES_ENV] ?? "").split(",")) {
    const id = item.trim();
    if (UUID.test(id)) out.add(id.toLowerCase());
  }
  return out;
}

/** Gli avvisi alle persone del cliente sono accesi per il workspace. */
export function clientNoticesEnabled(workspaceId: string | null | undefined, env: Env): boolean {
  if (typeof workspaceId !== "string" || !UUID.test(workspaceId.trim())) return false;
  if (!clientNoticeWorkspaceIds(env).has(workspaceId.trim().toLowerCase())) return false;
  return referentAskEnabled(workspaceId.trim(), env);
}

/**
 * «Pronto da avviare» (solo a Lateral Space) si scrive: area «Use case» accesa per il workspace e
 * non un'anteprima di Vercel. Non dipende da `USE_CASE_CLIENT_NOTICES`.
 */
export function readyNoticesEnabled(workspaceId: string | null | undefined, env: Env): boolean {
  if (env.VERCEL_ENV === "preview") return false;
  return isUseCaseHubWorkspace(workspaceId, env);
}
