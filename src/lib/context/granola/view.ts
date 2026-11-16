/**
 * Che cosa mostrano i due blocchi di Granola (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md §8.9): il blocco in
 * Impostazioni e la riga e il pannello nella pagina «Contesto». Funzioni pure, per i componenti e per i test: ogni testo
 * viene da `CONTEXT_TEXT.granola`; le date relative le scrive `Intl` («5 minuti fa», «ieri»).
 * Modulo puro: si può importare dai componenti client.
 */
import { CONTEXT_TEXT } from "../text.ts";
import type { GranolaConnectionStatus } from "../vocab.ts";

const T = CONTEXT_TEXT.granola;

export type Tone = "ok" | "info" | "error";
export interface Line {
  tone: Tone;
  text: string;
}

/** Lo stato del blocco in Impostazioni. */
export type GranolaCardState = "non_disponibile" | "non_collegato" | "collegato" | "da_ricollegare";

export function granolaCardState(status: { available: boolean; connected: boolean; status: GranolaConnectionStatus | null }): GranolaCardState {
  if (!status.available) return "non_disponibile";
  if (!status.connected) return "non_collegato";
  return status.status === "da_ricollegare" ? "da_ricollegare" : "collegato";
}

/** La riga dopo il ritorno da Granola (`?granola=…`): collegato, oppure non riuscito, oppure scaduto. */
export function granolaFlashLine(flash: string | null | undefined): Line | null {
  if (flash === "collegato") return { tone: "ok", text: T.connected };
  if (flash === "annullato" || flash === "errore") return { tone: "error", text: T.connectFailed };
  if (flash === "scaduto") return { tone: "error", text: T.stateExpired };
  return null;
}

const RELATIVE = new Intl.RelativeTimeFormat("it", { numeric: "auto" });

/** Quando, a parole: «ora», «5 minuti fa», «2 ore fa», «ieri», «3 giorni fa». Una data che non si legge: null. */
export function relativeWhen(value: Date | string | null | undefined, now: Date = new Date()): string | null {
  if (value === null || value === undefined) return null;
  const at = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(at.getTime())) return null;
  const seconds = Math.max(0, Math.round((now.getTime() - at.getTime()) / 1000));
  if (seconds < 60) return RELATIVE.format(0, "second");
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return RELATIVE.format(-minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return RELATIVE.format(-hours, "hour");
  return RELATIVE.format(-Math.floor(hours / 24), "day");
}

/** «Granola aggiornato 5 minuti fa», o null se non c'è ancora stato un giro. */
export function granolaUpdatedLine(lastSyncAt: Date | string | null | undefined, now: Date = new Date()): string | null {
  const when = relativeWhen(lastSyncAt, now);
  return when ? T.updatedAt(when) : null;
}

/** Che cosa dire dopo un giro. `quiet`: la riga compatta parla solo se è entrato qualcosa o se c'è da fare. */
export function granolaSyncLine(result: { status: string; imported: number; updated: number }, quiet = false): Line | null {
  switch (result.status) {
    case "fatto":
      if (quiet && result.imported === 0) return null;
      return { tone: result.imported > 0 ? "ok" : "info", text: T.imported(result.imported) };
    case "recente":
      return quiet ? null : { tone: "info", text: T.imported(0) };
    case "in_corso":
      return quiet ? null : { tone: "info", text: T.refreshing };
    case "limite":
      return quiet ? null : { tone: "error", text: T.rateLimited };
    case "da_ricollegare":
      return { tone: "error", text: T.expired };
    case "non_collegato":
      return quiet ? null : { tone: "info", text: T.notConnectedLine };
    default:
      return quiet ? null : { tone: "error", text: T.loadFailed };
  }
}

const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[a-z]{2,}$/i;
const DOMAIN = /^@?(?=[^\s@,;]{3,253}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/i;

/**
 * Quello che si scrive in «Persone e domini del cliente»: uno o più valori, separati da virgole, punti e virgola o
 * spazi. Un valore con `@` in mezzo è un'e-mail, uno senza (anche con `@` davanti) un dominio. Il resto è sbagliato.
 */
export function splitPeopleEntries(input: string): { emails: string[]; domains: string[]; invalid: string[] } {
  const out = { emails: [] as string[], domains: [] as string[], invalid: [] as string[] };
  for (const raw of String(input ?? "").split(/[\s,;]+/)) {
    const entry = raw.trim().toLowerCase();
    if (!entry) continue;
    if (EMAIL.test(entry)) {
      if (!out.emails.includes(entry)) out.emails.push(entry);
    } else if (DOMAIN.test(entry)) {
      const domain = entry.replace(/^@/, "");
      if (!out.domains.includes(domain)) out.domains.push(domain);
    } else {
      out.invalid.push(raw.trim());
    }
  }
  return out;
}

/** Le parole nel titolo scritte in un campo: separate da virgole, senza doppioni (maiuscole a parte). */
export function splitTitleWords(input: string, current: readonly string[] = []): string[] {
  const out = [...current];
  for (const raw of String(input ?? "").split(/[,;]+/)) {
    const word = raw.replace(/\s+/g, " ").trim();
    if (word && !out.some((w) => w.toLowerCase() === word.toLowerCase())) out.push(word);
  }
  return out;
}

/** La riga compatta della vista «Memoria»: solo quando c'è qualcosa da dire. */
export function granolaCompactLine(i: { syncing: boolean; last: { status: string; imported: number; updated: number } | null; unsortedCount: number }): { text: string; toNotes: boolean } | null {
  if (i.syncing) return { text: T.refreshing, toNotes: false };
  const after = i.last ? granolaSyncLine(i.last, true) : null;
  if (after && i.last && i.last.imported > 0) return { text: after.text, toNotes: true };
  if (i.unsortedCount > 0) return { text: T.unsorted(i.unsortedCount), toNotes: true };
  if (after) return { text: after.text, toNotes: false };
  return null;
}
