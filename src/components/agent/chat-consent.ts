import type { AiConsentNoticeData } from "../../lib/db/queries/context-consent.ts";

/**
 * L'ok ai sub-responsabili nella chat di Discovery e di mappatura (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md
 * §6.3). Al montaggio la chat chiede `GET /api/context/<ws>/consent`: senza l'ok mostra l'avviso calmo al posto del
 * campo per scrivere; dopo l'ok chiede di nuovo e il campo torna. Il controllo vero è della rotta della chat, che senza
 * l'ok risponde 403 `ok_fornitori_mancante` e non manda niente al modello: qui una risposta che non si legge lascia
 * scrivere, e un 403 della chat fa chiedere di nuovo. Modulo puro: lo importano anche i test con Node.
 */
export type ChatConsent = { state: "checking" } | { state: "ok" } | { state: "missing"; notice: AiConsentNoticeData };

export const CONSENT_CHECKING: ChatConsent = Object.freeze({ state: "checking" });
export const CONSENT_OK: ChatConsent = Object.freeze({ state: "ok" });

/** Il codice del 403 della rotta della chat quando manca l'ok. */
export const CHAT_CONSENT_ERROR = "ok_fornitori_mancante";

export function chatConsentPath(workspaceId: string): string {
  return `/api/context/${encodeURIComponent(workspaceId)}/consent`;
}

function isNotice(value: unknown): value is AiConsentNoticeData {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.workspaceId === "string" &&
    typeof v.companyName === "string" &&
    typeof v.listVersion === "string" &&
    typeof v.statement === "string" &&
    typeof v.settingsHref === "string" &&
    Array.isArray(v.suppliers) &&
    v.suppliers.every((name) => typeof name === "string") &&
    (v.declarer === null || v.declarer === "lateral_space" || v.declarer === "cliente") &&
    (v.buttonLabel === null || typeof v.buttonLabel === "string")
  );
}

/** La risposta della rotta dell'ok. Solo un `{ ok: false, notice }` ben fatto ferma il campo per scrivere. */
export function chatConsentFrom(status: number, body: unknown): ChatConsent {
  if (status !== 200 || !body || typeof body !== "object") return CONSENT_OK;
  const value = body as { ok?: unknown; notice?: unknown };
  return value.ok === false && isNotice(value.notice) ? { state: "missing", notice: value.notice } : CONSENT_OK;
}

/** Chiede l'ok del workspace. Non lancia: una rete che non risponde lascia scrivere (la rotta della chat controlla). */
export async function loadChatConsent(workspaceId: string, fetchImpl: (input: string, init?: RequestInit) => Promise<Response> = (input, init) => fetch(input, init)): Promise<ChatConsent> {
  try {
    const response = await fetchImpl(chatConsentPath(workspaceId), { cache: "no-store", headers: { accept: "application/json" } });
    const body: unknown = await response.json().catch(() => null);
    return chatConsentFrom(response.status, body);
  } catch {
    return CONSENT_OK;
  }
}

/** La rotta della chat ha risposto 403 perché manca l'ok (useChat mette il corpo della risposta nel messaggio). */
export function isConsentError(error: { message?: unknown } | null | undefined): boolean {
  return typeof error?.message === "string" && error.message.includes(CHAT_CONSENT_ERROR);
}

/** Il campo per scrivere si vede, tranne quando manca l'ok; mentre si controlla resta spento. */
export function composerState(consent: ChatConsent): "aperto" | "spento" | "avviso" {
  return consent.state === "missing" ? "avviso" : consent.state === "checking" ? "spento" : "aperto";
}
