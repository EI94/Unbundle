import "server-only";
/**
 * Granola per «Contesto» (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md §3.4.12, §8).
 *
 * Questo file è lo **stub** della fondazione: le firme sono quelle del piano, il corpo tiene tutto spento. Il
 * pacchetto «granola» scrive il corpo (collegamento OAuth, token cifrati, giro, «Da smistare», regole) senza cambiare
 * nomi né firme: la pagina, le Impostazioni e il cron `/api/cron/contesto` li usano già.
 *
 * Spento vuol dire: `granolaAvailable()` falso, nessun collegamento, nessun giro, nessuna richiesta a Granola. Le
 * scritture rispondono `area_spenta` con la frase «Il collegamento con Granola non è ancora attivo.».
 */
import { CONTEXT_TEXT } from "@/lib/context/text";
import type { ContextActor } from "@/lib/context/visibility";
import type { GranolaConnectionStatus } from "@/lib/context/vocab";
import type { ServiceResult } from "@/lib/use-cases/types";

/** Chiave `CONTEXT_TOKEN_KEY` valida, indirizzo pubblico noto, non un'anteprima di Vercel, `CONTEXT_GRANOLA` diverso da `off`. */
export function granolaAvailable(env?: Readonly<Record<string, string | undefined>>): boolean {
  void env;
  return false;
}

export interface GranolaStatus {
  available: boolean;
  connected: boolean;
  status: GranolaConnectionStatus | null;
  accountEmail: string | null;
  plan: string | null;
  lastSyncAt: Date | null;
  /** Collegato, e l'ultimo giro ha più di 30 minuti. */
  stale: boolean;
  unsortedCount: number;
  /** Call di questo workspace fermate dal controllo dei testi. */
  blockedCount: number;
}

export async function loadGranolaStatus(i: { userId: string; workspaceId: string; now?: Date }): Promise<GranolaStatus> {
  void i;
  return { available: false, connected: false, status: null, accountEmail: null, plan: null, lastSyncAt: null, stale: false, unsortedCount: 0, blockedCount: 0 };
}

const off = <T>(): ServiceResult<T> => ({ ok: false, error: "area_spenta", message: CONTEXT_TEXT.granola.unavailable });

export async function startGranolaConnect(actor: ContextActor): Promise<ServiceResult<{ url: string }>> {
  void actor;
  return off();
}

export async function finishGranolaConnect(i: { userId: string; state: string; code: string }): Promise<ServiceResult<{ workspaceId: string }>> {
  void i;
  return off();
}

export async function disconnectGranola(userId: string): Promise<ServiceResult<true>> {
  void userId;
  return off();
}

export type GranolaSyncStatus = "fatto" | "recente" | "in_corso" | "non_collegato" | "da_ricollegare" | "limite" | "non_riuscito";
export interface GranolaSyncResult {
  status: GranolaSyncStatus;
  imported: number;
  updated: number;
  blocked: number;
  unsorted: number;
}

/** Il giro di una persona. `force` falso: `recente` se l'ultimo ha meno di 30 minuti. */
export async function syncGranolaForUser(userId: string, o?: { force?: boolean; budgetMs?: number; now?: Date }): Promise<GranolaSyncResult> {
  void userId;
  void o;
  return { status: "non_collegato", imported: 0, updated: 0, blocked: 0, unsorted: 0 };
}

/** Il giro della notte, per ogni persona collegata; toglie i collegamenti di chi non è più di Lateral Space e gli stati OAuth scaduti. */
export async function syncGranolaAll(o: { budgetMs: number; now?: Date }): Promise<{ users: number; imported: number; errors: number }> {
  void o;
  return { users: 0, imported: 0, errors: 0 };
}

export interface UnsortedMeeting {
  id: string;
  title: string;
  date: string | null;
  participants: string;
}

/** «Da smistare», letto dal vivo da Granola con il token di chi guarda. Niente si salva. */
export async function listGranolaUnsorted(actor: ContextActor): Promise<ServiceResult<UnsortedMeeting[]>> {
  void actor;
  return off();
}

export async function assignGranolaMeeting(actor: ContextActor, meetingId: string): Promise<ServiceResult<{ sourceId: string }>> {
  void actor;
  void meetingId;
  return off();
}

export async function leaveOutGranolaMeetings(actor: ContextActor, meetingIds: readonly string[]): Promise<ServiceResult<{ left: number }>> {
  void actor;
  void meetingIds;
  return off();
}

export interface GranolaRulesView {
  /** Di chi guarda, per questo workspace. */
  folder: { id: string; name: string } | null;
  /** Persone del cliente che Unbundle conosce già. */
  knownPeople: number;
  emails: string[];
  domains: string[];
  /** Quelle salvate, o le predefinite dal nome. */
  titleWords: string[];
  titleWordsAreDefault: boolean;
  wantTranscript: boolean;
  transcriptAvailable: boolean;
}

export async function readGranolaRules(actor: ContextActor): Promise<GranolaRulesView | null> {
  void actor;
  return null;
}

export async function saveGranolaRules(
  actor: ContextActor,
  input: { folderId: string | null; folderName: string | null; emails: string[]; domains: string[]; titleWords: string[]; wantTranscript: boolean },
): Promise<ServiceResult<true>> {
  void actor;
  void input;
  return off();
}

export async function listGranolaFolders(actor: ContextActor): Promise<ServiceResult<Array<{ id: string; name: string }>>> {
  void actor;
  return off();
}
