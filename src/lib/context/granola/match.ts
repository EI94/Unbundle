/**
 * Di quale cliente è una call di Granola (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md §8.6).
 *
 * Per ogni workspace dove la persona collegata è di Lateral Space, la regola più forte che corrisponde:
 * 1. **cartella**: la call sta nella cartella di Granola scelta per quel cliente;
 * 2. **partecipanti**: tra i partecipanti c'è una persona del cliente che Unbundle conosce (un contatto o un referente),
 *    o un indirizzo o un dominio aggiunto a mano. Chi ha un dominio di Lateral Space non conta (chi registra è sempre
 *    tra loro), e nemmeno chi ha registrato la call. Una casella di posta pubblica (`PUBLIC_MAIL_DOMAINS`) non vale mai
 *    come dominio; un indirizzo intero lì (di un contatto, o aggiunto a mano) vale solo per quella persona;
 * 3. **titolo**: il titolo contiene una delle parole del cliente, come parola intera, senza maiuscole e accenti.
 * Si guarda il livello più forte raggiunto da almeno un workspace: se lo raggiunge uno solo, e il titolo non dice anche
 * un altro cliente, la call entra lì; se lo raggiungono in due o più, se il titolo dice anche un altro cliente, o se non
 * lo raggiunge nessuno, la call va in «Da smistare».
 * Modulo puro.
 */

/**
 * Le caselle di posta pubbliche, in un elenco solo: un dominio così farebbe entrare le call di chiunque, e non vale mai
 * (né nelle regole di Impostazioni, né in una regola vecchia). Un indirizzo intero lì, di un contatto o aggiunto a mano,
 * vale solo per quella persona, confrontato per uguale. Valgono anche i sottodomini.
 */
export const PUBLIC_MAIL_DOMAINS: readonly string[] = Object.freeze([
  // Internazionali
  "gmail.com", "googlemail.com", "outlook.com", "outlook.it", "hotmail.com", "hotmail.it", "live.com", "live.it", "msn.com",
  "yahoo.com", "yahoo.it", "ymail.com", "rocketmail.com", "icloud.com", "me.com", "mac.com", "aol.com",
  "proton.me", "protonmail.com", "pm.me", "gmx.com", "gmx.net", "gmx.it", "gmx.de", "mail.com", "zoho.com", "yandex.com", "tutanota.com",
  // Italiane
  "libero.it", "virgilio.it", "alice.it", "tim.it", "tin.it", "tiscali.it", "email.it", "inwind.it", "iol.it",
  "fastwebnet.it", "katamail.com", "teletu.it", "vodafone.it", "poste.it",
  // Posta certificata condivisa
  "pec.it", "legalmail.it", "postecert.it", "arubapec.it",
]);

/** Vero se il dominio è una casella di posta pubblica (`PUBLIC_MAIL_DOMAINS`) o un suo sottodominio. */
export function isPublicMailDomain(domain: string | null | undefined): boolean {
  const d = String(domain ?? "").trim().toLowerCase().replace(/^@/, "");
  return d !== "" && PUBLIC_MAIL_DOMAINS.some((base) => d === base || d.endsWith(`.${base}`));
}

export interface WorkspaceMatchProfile {
  workspaceId: string;
  folderIds: string[];
  /** In minuscolo. */
  emails: string[];
  /** In minuscolo, senza `@`. */
  domains: string[];
  titleWords: string[];
}

export type MatchRule = "cartella" | "partecipanti" | "titolo";

export interface MeetingMatch {
  /** La regola più forte raggiunta da almeno un workspace; null se nessuno. */
  rule: MatchRule | null;
  /** I workspace a quel livello, più quelli che il titolo dice: la call entra da sola solo se è uno. */
  workspaceIds: string[];
}

const RULES: readonly MatchRule[] = ["cartella", "partecipanti", "titolo"];

/** Minuscole e senza accenti: «Società» come «societa». */
export function foldWord(text: string): string {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase();
}

const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

/** Vero se `word` (una o più parole) compare in `title` come parola intera, senza maiuscole e accenti: «Nardi» non è in «Bernardini». */
export function titleHasWord(title: string, word: string): boolean {
  const haystack = foldWord(title).replace(/\s+/g, " ");
  const needle = foldWord(word).replace(/\s+/g, " ").trim();
  if (!needle || !haystack) return false;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) return false;
    const before = at === 0 ? "" : haystack[at - 1];
    const after = haystack[at + needle.length] ?? "";
    if (!LETTER_OR_DIGIT.test(before) && !LETTER_OR_DIGIT.test(after)) return true;
    from = at + 1;
  }
}

/** Le parole che non dicono di quale cliente si parla. */
const GENERIC_WORDS = new Set(
  ["spa", "srl", "srls", "sas", "snc", "group", "gruppo", "holding", "italia", "company", "società", "workspace", "test", "demo", "prova", "cliente", "lateral", "space", "unbundle"].map(foldWord),
);

/**
 * Le parole predefinite per il titolo: la prima parola del nome del workspace con almeno 4 lettere che non è una parola
 * generica. Una sola: una parola in più farebbe entrare le call di un altro cliente. «Nardi Motorsport» → «Nardi».
 */
export function defaultTitleWords(workspaceName: string): string[] {
  for (const word of String(workspaceName ?? "").split(/[^\p{L}\p{N}]+/u)) {
    const letters = word.match(/\p{L}/gu)?.length ?? 0;
    if (letters >= 4 && !GENERIC_WORDS.has(foldWord(word))) return [word];
  }
  return [];
}

/** Il dominio di un'e-mail, in minuscolo, o null. */
export function emailDomainOf(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return null;
  return email.slice(at + 1).toLowerCase();
}

/** Vero se `domain` è `base` o un suo sottodominio. */
function inDomain(domain: string, base: string): boolean {
  return domain === base || domain.endsWith(`.${base}`);
}

/** Vero se il titolo contiene una delle parole del cliente. */
function titleMatches(title: string, profile: WorkspaceMatchProfile): boolean {
  return profile.titleWords.some((word) => titleHasWord(title, word));
}

/** Il livello (0 cartella, 1 partecipanti, 2 titolo) a cui un profilo riconosce la call, o -1. */
function levelOf(meeting: { title: string; participantEmails: string[]; folderIds: string[] }, profile: WorkspaceMatchProfile): number {
  if (profile.folderIds.length > 0 && meeting.folderIds.some((id) => profile.folderIds.includes(id))) return 0;
  // Un indirizzo vale per sé, anche in una casella pubblica: solo uguale. Un dominio di una casella pubblica non vale mai,
  // anche se una regola vecchia lo porta.
  const emails = new Set(profile.emails.map((e) => e.toLowerCase()));
  const domains = profile.domains.map((d) => d.toLowerCase().replace(/^@/, "")).filter((d) => d && !isPublicMailDomain(d));
  for (const email of meeting.participantEmails) {
    if (emails.has(email)) return 1;
    const domain = emailDomainOf(email);
    if (domain && domains.some((base) => inDomain(domain, base))) return 1;
  }
  if (titleMatches(meeting.title, profile)) return 2;
  return -1;
}

/**
 * La decisione su una call. `participantEmails`: le e-mail dei partecipanti, già senza chi ha registrato; quelle con un
 * dominio di Lateral Space (`lsDomains`) si tolgono qui.
 */
export function matchMeeting(
  meeting: { title: string; participantEmails: string[]; folderIds: string[] },
  profiles: readonly WorkspaceMatchProfile[],
  lsDomains: readonly string[],
): MeetingMatch {
  const ls = lsDomains.map((d) => d.toLowerCase().replace(/^@/, ""));
  const participantEmails = [
    ...new Set(
      meeting.participantEmails
        .map((e) => String(e ?? "").trim().toLowerCase())
        .filter((e) => {
          const domain = emailDomainOf(e);
          return domain !== null && !ls.some((base) => inDomain(domain, base));
        }),
    ),
  ];
  const subject = { title: String(meeting.title ?? ""), participantEmails, folderIds: meeting.folderIds };
  let best = -1;
  let ids: string[] = [];
  for (const profile of profiles) {
    const level = levelOf(subject, profile);
    if (level < 0) continue;
    if (best < 0 || level < best) {
      best = level;
      ids = [profile.workspaceId];
    } else if (level === best && !ids.includes(profile.workspaceId)) {
      ids.push(profile.workspaceId);
    }
  }
  if (best < 0) return { rule: null, workspaceIds: [] };
  // Il titolo dice anche un altro cliente: la call non entra da sola, nemmeno con la cartella o i partecipanti.
  for (const profile of profiles) {
    if (!ids.includes(profile.workspaceId) && titleMatches(subject.title, profile)) ids.push(profile.workspaceId);
  }
  return { rule: RULES[best], workspaceIds: ids };
}
