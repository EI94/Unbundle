/**
 * Quando «Chiedi al referente» è acceso (SPEC §0 «Availability»).
 *
 * - `referentAskEnabled`: l'interruttore `USE_CASE_REFERENTS` non è `off`, non siamo in
 *   un'anteprima di Vercel (le anteprime usano il database di produzione) e l'area «Use case» è
 *   accesa per il workspace (`isUseCaseHubWorkspace`). **Non** dipende da `UC_ENABLED` né da
 *   `UC_WORKSPACE_IDS`: spegnere i dossier non spegne questa funzione (per spegnerla:
 *   `USE_CASE_REFERENTS=off`).
 * - `referentPublicWritesAvailable`: su qualunque ambiente Vercel (anteprima compresa) le scritture
 *   della pagina pubblica vogliono `UC_SECRET` (impronta dell'IP e limite per IP); fuori da Vercel
 *   (harness, locale) si scrive anche senza.
 *
 * Modulo puro: le variabili arrivano come parametro.
 */
import { isUseCaseHubWorkspace } from "../rollout.ts";

type Env = Readonly<Record<string, string | undefined>>;

/** La funzione è accesa per il workspace. `UC_ENABLED` non si legge, di proposito. */
export function referentAskEnabled(workspaceId: string | null | undefined, env: Env): boolean {
  if (env.USE_CASE_REFERENTS?.trim() === "off") return false;
  if (env.VERCEL_ENV === "preview") return false;
  return isUseCaseHubWorkspace(workspaceId, env);
}

/** Le scritture pubbliche si accettano: con `VERCEL_ENV` impostato serve `UC_SECRET`. */
export function referentPublicWritesAvailable(env: Env): boolean {
  if (env.VERCEL_ENV === undefined || env.VERCEL_ENV === "") return true;
  return Boolean(env.UC_SECRET?.trim());
}
