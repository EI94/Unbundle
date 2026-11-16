/**
 * Di quale cliente è una call di Granola (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md §8.6).
 *
 * Per ogni workspace dove la persona collegata è di Lateral Space, la regola più forte che corrisponde:
 * 1. **cartella**: la call sta nella cartella di Granola scelta per quel cliente;
 * 2. **partecipanti**: tra i partecipanti c'è una persona del cliente che Unbundle conosce, o un indirizzo o un dominio
 *    aggiunto a mano. Chi ha un dominio di Lateral Space non conta (chi registra è sempre tra loro), e nemmeno chi ha
 *    registrato la call;
 * 3. **titolo**: il titolo contiene una delle parole del cliente, come parola intera, senza maiuscole e accenti.
 * Si guarda il livello più forte raggiunto da almeno un workspace: se lo raggiunge uno solo, la call entra lì; se lo
 * raggiungono in due o più, o nessuno, la call va in «Da smistare».
 * Modulo puro.
 */

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
  /** I workspace a quel livello: la call entra da sola solo se è uno. */
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

/** Il livello (0 cartella, 1 partecipanti, 2 titolo) a cui un profilo riconosce la call, o -1. */
function levelOf(meeting: { title: string; participantEmails: string[]; folderIds: string[] }, profile: WorkspaceMatchProfile): number {
  if (profile.folderIds.length > 0 && meeting.folderIds.some((id) => profile.folderIds.includes(id))) return 0;
  const emails = new Set(profile.emails.map((e) => e.toLowerCase()));
  const domains = profile.domains.map((d) => d.toLowerCase().replace(/^@/, "")).filter(Boolean);
  for (const email of meeting.participantEmails) {
    if (emails.has(email)) return 1;
    const domain = emailDomainOf(email);
    if (domain && domains.some((base) => inDomain(domain, base))) return 1;
  }
  if (profile.titleWords.some((word) => titleHasWord(meeting.title, word))) return 2;
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
  return best < 0 ? { rule: null, workspaceIds: [] } : { rule: RULES[best], workspaceIds: ids };
}
