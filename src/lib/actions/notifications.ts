"use server";

import { BELL_TEXT, type BellPayload } from "@/lib/notifications/bell";

export type BellActionResult =
  | { ok: true; payload: BellPayload }
  | { ok: false; code: "non_autenticato" | "non_disponibile" | "dati_non_validi" | "riprova"; message: string };

/** «Segna tutte come lette» fino a `upTo` (giorno 0: in arrivo). */
export async function markAllBellReadAction(workspaceId: string, upTo: string | null): Promise<BellActionResult> {
  void workspaceId;
  void upTo;
  return { ok: false, code: "riprova", message: BELL_TEXT.errors.readAll };
}

/** La scelta sulle email di chi ha chiesto (giorno 0: in arrivo). */
export async function setBellEmailAlertsAction(workspaceId: string, on: boolean): Promise<BellActionResult> {
  void workspaceId;
  void on;
  return { ok: false, code: "riprova", message: BELL_TEXT.errors.preference };
}
