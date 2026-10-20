/**
 * Avviso a Lateral Space per un token arrivato dentro un indirizzo web (prompt WP4:
 * il token si considera compromesso, si segna «esposto, da revocare» in dashboard e
 * si avvisa Lateral Space con la notifica esistente).
 *
 * - Lo stato «esposto, da revocare» sta sulla riga del token (`exposed_at`, scritto
 *   da `markIntegrationTokenExposed`): lo mostra la scheda «Connettore Claude» di chi
 *   gestisce il workspace (K7r) e nessun membro lo può spegnere.
 * - L'avviso va nel canale admin di Slack del workspace, lo stesso dei nuovi
 *   contributi (`src/lib/notifications/portfolio-dispatch.ts`), scelto da chi
 *   amministra l'organizzazione. Non va nella campanella (`weekly_signals`): quella
 *   la vede ogni membro, chiunque la segna letta per tutti e finisce nel prompt
 *   dell'analisi competitiva (la stessa regola di `src/lib/uc/notify/bell.ts`).
 * - Parte una volta sola per token: chi chiama lo manda solo quando
 *   `markIntegrationTokenExposed` ha appena segnato il token.
 * - Testo fisso: mai token, hash, prefisso, etichetta, nomi o indirizzo.
 * - Senza Slack, o senza canale scelto, non parte nulla e resta lo stato nella
 *   scheda. Un errore, o un'attesa oltre `EXPOSED_TOKEN_ALERT_TIMEOUT_MS`, finisce
 *   nel log con `logSafeError` e non cambia la risposta (400 `token_in_url`).
 *
 * Modulo puro: Slack arriva dalle dipendenze (`appExposedTokenAlertDeps` in
 * `app-deps.ts`); gira con `node --test`.
 */
import { logSafeError } from "../log/safe-error.ts";
import { CONNECTOR_PROVIDER } from "./auth.ts";

/** Canale admin di Slack del workspace e token del bot dell'installazione. */
export interface SlackAlertTarget {
  channelId: string;
  botToken: string;
}

export interface ExposedTokenAlertDeps {
  /** Il canale admin di Slack del workspace, oppure null (Slack non installato o senza canale). */
  findAdminChannel(workspaceId: string): Promise<SlackAlertTarget | null>;
  post(target: SlackAlertTarget, text: string): Promise<void>;
  /** Attesa massima dell'avviso, in millisecondi (predefinita `EXPOSED_TOKEN_ALERT_TIMEOUT_MS`). */
  timeoutMs?: number;
  log?: Pick<Console, "error">;
}

/** L'avviso non trattiene la risposta oltre questo tempo. */
export const EXPOSED_TOKEN_ALERT_TIMEOUT_MS = 5_000;

/** Testo dell'avviso, fisso: dipende solo dal tipo di token. */
export function exposedTokenAlertText(provider: string): string {
  if (provider === CONNECTOR_PROVIDER) {
    return (
      ":warning: *Token del connettore Claude esposto, da revocare.* " +
      "Il token è arrivato dentro un indirizzo web, dove i log lo registrano: consideralo compromesso. " +
      "Lo trovi segnato in Impostazioni › Integrazioni › Connettore Claude. " +
      "Nessuna revoca automatica: revocarlo ferma il connettore per tutta l'organizzazione; " +
      "con il token nuovo l'Owner rimuove e riaggiunge il connettore e tutti rifanno «Connetti»."
    );
  }
  return (
    ":warning: *Token di Claude esposto, da revocare.* " +
    "Un token di accesso di Claude a Unbundle è arrivato dentro un indirizzo web, dove i log lo registrano: consideralo compromesso. " +
    "Revocalo in Impostazioni › Integrazioni e creane uno nuovo."
  );
}

export type ExposedTokenAlertOutcome = "sent" | "no_channel" | "failed";

/** Manda l'avviso nel canale admin di Slack del workspace del token appena segnalato. */
export async function alertExposedToken(
  exposed: { workspaceId: string; provider: string },
  deps: ExposedTokenAlertDeps
): Promise<ExposedTokenAlertOutcome> {
  const work = (async (): Promise<ExposedTokenAlertOutcome> => {
    const target = await deps.findAdminChannel(exposed.workspaceId);
    if (!target) return "no_channel";
    await deps.post(target, exposedTokenAlertText(exposed.provider));
    return "sent";
  })();
  // Se vince l'attesa, un errore arrivato dopo non resta senza gestione.
  work.catch(() => {});
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(Object.assign(new Error("alert timeout"), { name: "TimeoutError" })),
      deps.timeoutMs ?? EXPOSED_TOKEN_ALERT_TIMEOUT_MS
    );
  });
  try {
    return await Promise.race([work, timeout]);
  } catch (error) {
    logSafeError("connector", "exposed_token_alert_failed", error, {}, deps.log);
    return "failed";
  } finally {
    clearTimeout(timer);
  }
}
