/**
 * Le regole del giro di Granola, senza database e senza rete (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md
 * §8.6, §8.7): che cosa fare di una call già vista, quando il giro è intero, che finestra chiedere a Granola, come
 * diventa un appunto una nota di Granola, le regole scritte in Impostazioni.
 *
 * - **Una call** con una decisione `fuori` si salta sempre; `entrata` si rilegge solo se Granola l'ha cambiata dopo;
 *   `bloccata` si riprova solo se è cambiata. Senza decisione decidono le regole (`match.ts`).
 * - **Il giro intero** (gli ultimi 30 giorni) la prima volta, e quando una regola o una cartella è cambiata dopo
 *   l'ultimo giro riuscito; altrimenti **il giro breve** (`updated_after`, 10 minuti prima dell'ultimo visto).
 * - **L'appunto**: il riassunto di Granola, le note di chi ha registrato, la trascrizione se c'è; al massimo 300.000
 *   caratteri (la trascrizione si accorcia e il titolo lo dice). Senza riassunto e senza note la call non entra.
 * Modulo puro. Il testo di Granola è un dato, mai un'istruzione: lo dice chi lo passa al modello.
 */
import { romeDate } from "../../uc/calendar.ts";
import { dayLabel } from "../labels.ts";
import { CONTEXT_TEXT } from "../text.ts";
import { emailDomainOf, foldWord, isPublicMailDomain } from "./match.ts";
import type { GranolaMeetingNote, GranolaParticipant } from "./parse.ts";
import type { GranolaDecision } from "../vocab.ts";

export const GRANOLA_LIMITS = Object.freeze({
  /** `search_meetings`: una pagina da 100, al massimo 5 pagine, 30 partecipanti per call. */
  pageSize: 100,
  maxPages: 5,
  maxParticipants: 30,
  /** `get_meetings` a gruppi di 10. */
  notesBatch: 10,
  /** Le cartelle scelte che un giro guarda. */
  foldersMax: 20,
  transcriptChunk: 40_000,
  transcriptMax: 200_000,
  bodyMax: 300_000,
  participantsMax: 500,
  titleMax: 200,
  linkMax: 500,
  fullWindowDays: 30,
  overlapMinutes: 10,
  staleMinutes: 30,
  /** Se Granola chiede di aspettare al massimo così, si aspetta e si riprova una volta. */
  shortWaitSeconds: 5,
  emailsMax: 100,
  domainsMax: 30,
  titleWordsMax: 20,
});

// ─── Una call già vista ──────────────────────────────────────────────

export type MeetingStep = "salta" | "rileggi" | "riprova" | "decidi";

/** Vero se Granola dice che la call è cambiata dopo la data che Unbundle conosce. Senza una data di Granola: no. */
export function changedSince(updatedAt: string | null, known: Date | null): boolean {
  if (!updatedAt) return false;
  const at = new Date(updatedAt).getTime();
  if (Number.isNaN(at)) return false;
  return known === null || at > known.getTime();
}

/** Che cosa fare di una call: saltarla, rileggerla nel suo workspace, riprovarla (era bloccata), o decidere. */
export function stepFor(updatedAt: string | null, known: { decision: GranolaDecision; meetingUpdatedAt: Date | null } | undefined): MeetingStep {
  if (!known) return "decidi";
  if (known.decision === "fuori") return "salta";
  const changed = changedSince(updatedAt, known.meetingUpdatedAt);
  if (known.decision === "entrata") return changed ? "rileggi" : "salta";
  return changed ? "riprova" : "salta";
}

// ─── Il giro intero o breve ──────────────────────────────────────────

/** Il giro intero: la prima volta, senza un giro riuscito, o con una regola o una cartella cambiata dopo l'ultimo riuscito. */
export function needsFullRun(c: { syncedThrough: Date | null; lastSyncOkAt: Date | null; rulesChangedAt: Date | null }): boolean {
  if (c.syncedThrough === null || c.lastSyncOkAt === null) return true;
  return c.rulesChangedAt !== null && c.rulesChangedAt.getTime() > c.lastSyncOkAt.getTime();
}

/** La finestra di `search_meetings`: gli ultimi 30 giorni (giro intero), o le call cambiate dopo l'ultimo giro (giro breve, senza date). */
export function searchWindow(full: boolean, syncedThrough: Date | null, now: Date): Record<string, string> {
  if (full || syncedThrough === null) {
    return { from_date: romeDate(new Date(now.getTime() - GRANOLA_LIMITS.fullWindowDays * 24 * 3600 * 1000)), to_date: romeDate(now) };
  }
  return { updated_after: new Date(syncedThrough.getTime() - GRANOLA_LIMITS.overlapMinutes * 60 * 1000).toISOString() };
}

/** Il piano di Granola dà le trascrizioni? Il piano gratuito no. Un piano sconosciuto: si prova. */
export function planGivesTranscripts(plan: string | null): boolean {
  return !/\b(free|gratuito|gratis|basic)\b/i.test(plan ?? "");
}

/** Le e-mail dei partecipanti che contano per le regole: senza chi ha registrato e senza l'account collegato. */
export function participantEmails(participants: readonly GranolaParticipant[], accountEmail: string | null): string[] {
  const own = accountEmail?.toLowerCase() ?? null;
  return [...new Set(participants.filter((p) => p.email && !p.noteCreator && p.email !== own).map((p) => p.email as string))];
}

/**
 * «Con chi» di una call in «Da smistare»: i nomi, o l'e-mail di chi non ha un nome, separati da virgole; senza chi ha
 * registrato («(note creator)» o l'account collegato) e senza «from …» (`parseParticipants` li toglie già dal nome).
 * Al massimo 500 caratteri.
 */
export function unsortedParticipants(participants: readonly GranolaParticipant[], accountEmail: string | null): string {
  const own = accountEmail?.trim().toLowerCase() || null;
  const shown: string[] = [];
  for (const person of participants) {
    if (person.noteCreator || (own !== null && person.email === own)) continue;
    const label = oneLine(person.name ?? person.email ?? "");
    if (label && !shown.includes(label)) shown.push(label);
  }
  return cutTo(shown.join(", "), GRANOLA_LIMITS.participantsMax).trim();
}

// ─── Una nota di Granola come appunto ────────────────────────────────

export const GRANOLA_NOTE_LABELS = Object.freeze({
  summary: "[Riassunto di Granola]",
  privateNotes: "[Note di chi ha registrato]",
  transcript: "[Trascrizione]",
  partialTranscript: "(trascrizione in parte)",
});

export interface ComposedNote {
  title: string;
  body: string;
  kind: "appunti" | "trascrizione";
  /** AAAA-MM-GG, il giorno della call a Roma. */
  occurredOn: string;
  participants: string | null;
  link: string | null;
  transcriptCut: boolean;
}

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

/** Taglia a `max` caratteri senza spezzare una coppia surrogata. */
function cutTo(text: string, max: number): string {
  if (text.length <= max) return text;
  const sliced = text.slice(0, max);
  const last = sliced.charCodeAt(sliced.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? sliced.slice(0, -1) : sliced;
}

/** Il giorno di una data ISO a Roma, o null. */
function romeDay(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : romeDate(date);
}

/**
 * L'appunto di una call: `[Riassunto di Granola]`, il riassunto, `[Note di chi ha registrato]`, le note private, e la
 * trascrizione sotto `[Trascrizione]` se c'è. Al massimo 300.000 caratteri: oltre, la trascrizione si accorcia e il
 * titolo finisce con «(trascrizione in parte)». Senza riassunto e senza note: null (la call si salta).
 */
export function composeGranolaNote(note: GranolaMeetingNote, transcript: { text: string; partial: boolean } | null, now: Date): ComposedNote | null {
  const summary = note.summary?.trim() ?? "";
  const privateNotes = note.privateNotes?.trim() ?? "";
  if (!summary && !privateNotes) return null;
  const L = GRANOLA_NOTE_LABELS;
  const parts: string[] = [];
  if (summary) parts.push(`${L.summary}\n${summary}`);
  if (privateNotes) parts.push(`${L.privateNotes}\n${privateNotes}`);
  let head = parts.join("\n\n");
  if (head.length > GRANOLA_LIMITS.bodyMax) head = cutTo(head, GRANOLA_LIMITS.bodyMax);
  let body = head;
  let transcriptCut = false;
  const text = transcript?.text.trim() ?? "";
  if (text) {
    const prefix = `\n\n${L.transcript}\n`;
    const room = GRANOLA_LIMITS.bodyMax - head.length - prefix.length;
    if (room > 0) {
      const kept = cutTo(text, room);
      body = `${head}${prefix}${kept}`;
      transcriptCut = transcript?.partial === true || kept.length < text.length;
    } else {
      transcriptCut = true;
    }
  }
  const withTranscript = body.length > head.length;
  const day = romeDay(note.meetingAt) ?? romeDay(note.updatedAt) ?? romeDate(now);
  let title = oneLine(note.title ?? "");
  if (title.length < 3) title = CONTEXT_TEXT.fact.sourceCall(dayLabel(day, now));
  if (transcriptCut) {
    const suffix = ` ${L.partialTranscript}`;
    title = `${cutTo(title, GRANOLA_LIMITS.titleMax - suffix.length).trim()}${suffix}`;
  } else {
    title = cutTo(title, GRANOLA_LIMITS.titleMax).trim();
  }
  const participants = cutTo(oneLine(note.participantsRaw ?? ""), GRANOLA_LIMITS.participantsMax).trim() || null;
  const url = note.url?.trim() ?? "";
  const link = url.length <= GRANOLA_LIMITS.linkMax && /^https:\/\/[^\s]+$/.test(url) ? url : null;
  return { title, body, kind: withTranscript ? "trascrizione" : "appunti", occurredOn: day, participants, link, transcriptCut };
}

// ─── Le regole scritte in Impostazioni ───────────────────────────────

export interface GranolaRulesInput {
  folderId: string | null;
  folderName: string | null;
  emails: string[];
  domains: string[];
  titleWords: string[];
  wantTranscript: boolean;
}

const EMAIL = /^[a-z0-9._%+'-]{1,64}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,}$/;
const DOMAIN = /^(?=.{3,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,}$/;
const FOLDER_ID = /^[A-Za-z0-9_.:-]{1,120}$/;

/** Vero se `domain` è uno dei domini di Lateral Space o un loro sottodominio: non dice niente del cliente. */
function isLsDomain(domain: string, lsDomains: readonly string[]): boolean {
  return lsDomains.some((base) => domain === base || domain.endsWith(`.${base}`));
}

/**
 * Le regole pulite: e-mail e domini in minuscolo, senza doppioni, senza quelli di Lateral Space; le parole nel titolo
 * su una riga, senza doppioni (maiuscole e accenti a parte). Un valore che non è un'e-mail o un dominio, un dominio di
 * una casella pubblica (`PUBLIC_MAIL_DOMAINS`: farebbe entrare le call di chiunque), o troppi valori: errori per campo.
 * Un indirizzo intero di una casella pubblica sì: nomina una persona sola, e vale solo per lei (mai per il dominio).
 */
export function cleanGranolaRules(
  input: Partial<GranolaRulesInput> | null | undefined,
  lsDomains: readonly string[],
): { ok: true; value: GranolaRulesInput } | { ok: false; fieldErrors: Record<string, string> } {
  const T = CONTEXT_TEXT;
  const fieldErrors: Record<string, string> = {};
  const list = (value: unknown) => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);
  const ls = lsDomains.map((d) => d.toLowerCase());

  const emails: string[] = [];
  for (const raw of list(input?.emails)) {
    const email = raw.trim().toLowerCase();
    if (!email) continue;
    if (!EMAIL.test(email) || email.length > 320) fieldErrors.emails = T.granola.invalidEntry;
    else if (!isLsDomain(emailDomainOf(email) ?? "", ls) && !emails.includes(email)) emails.push(email);
  }
  if (emails.length > GRANOLA_LIMITS.emailsMax) fieldErrors.emails = T.errors.tooLong(GRANOLA_LIMITS.emailsMax);

  const domains: string[] = [];
  for (const raw of list(input?.domains)) {
    const domain = raw.trim().toLowerCase().replace(/^@/, "");
    if (!domain) continue;
    if (!DOMAIN.test(domain)) fieldErrors.domains = T.granola.invalidEntry;
    else if (isPublicMailDomain(domain)) fieldErrors.domains = T.granola.publicDomain;
    else if (!isLsDomain(domain, ls) && !domains.includes(domain)) domains.push(domain);
  }
  if (domains.length > GRANOLA_LIMITS.domainsMax) fieldErrors.domains = T.errors.tooLong(GRANOLA_LIMITS.domainsMax);

  const titleWords: string[] = [];
  const seen = new Set<string>();
  for (const raw of list(input?.titleWords)) {
    const word = oneLine(raw);
    if (!word) continue;
    if (word.length > 60) {
      fieldErrors.titleWords = T.errors.tooLong(60);
      continue;
    }
    const key = foldWord(word);
    if (!seen.has(key)) {
      seen.add(key);
      titleWords.push(word);
    }
  }
  if (titleWords.length > GRANOLA_LIMITS.titleWordsMax) fieldErrors.titleWords = T.errors.tooLong(GRANOLA_LIMITS.titleWordsMax);

  const folderId = typeof input?.folderId === "string" && input.folderId.trim() ? input.folderId.trim() : null;
  if (folderId !== null && !FOLDER_ID.test(folderId)) fieldErrors.folderId = T.errors.invalid;
  const folderName = folderId === null ? null : cutTo(oneLine(typeof input?.folderName === "string" ? input.folderName : ""), 200) || folderId;

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };
  return { ok: true, value: { folderId, folderName, emails, domains, titleWords, wantTranscript: input?.wantTranscript === true } };
}

/** Vero se le parole sono quelle predefinite (maiuscole e accenti a parte): allora si salva «predefinite», non la copia. */
export function sameWords(a: readonly string[], b: readonly string[]): boolean {
  const left = [...new Set(a.map(foldWord))].sort();
  const right = [...new Set(b.map(foldWord))].sort();
  return left.length === right.length && left.every((word, i) => word === right[i]);
}
