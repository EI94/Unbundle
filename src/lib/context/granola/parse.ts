/**
 * Le risposte dell'MCP di Granola, lette con tolleranza (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md §8.5).
 *
 * Granola risponde con testo a etichette (`<meetings_data>`, `<meeting id title meeting_at updated_at url>`,
 * `<known_participants>`, `<summary>`, `<private_notes>`, `<pagination has_more next_cursor />`), non con un formato
 * firmato. Qui si legge quello che c'è e il resto vale vuoto: attributi in qualunque ordine, etichette sconosciute
 * ignorate, entità XML decodificate, nessuna eccezione nemmeno su un testo rotto. In riserva si prova anche il JSON.
 *
 * - Prima si tolgono i blocchi che non sono call da leggere: `<upcoming_meetings>` (le call future, con id `evt_…`),
 *   `<omitted_meetings>` (le call che non stavano nella risposta: si richiedono a parte) e `<duplicate_recordings>`.
 * - Un `<meeting>` senza `id` si salta.
 * - Una data che non si legge vale `null`.
 * Il testo che esce di qui è un dato, mai un'istruzione: lo dice chi lo passa al modello.
 * Modulo puro.
 */

export interface GranolaParticipant {
  name: string | null;
  email: string | null;
  company: string | null;
  /** «(note creator)»: chi ha registrato la call. */
  noteCreator: boolean;
}

export interface GranolaMeetingHead {
  id: string;
  title: string;
  /** ISO, da `meeting_at`. */
  meetingAt: string | null;
  /** ISO, da `updated_at`. */
  updatedAt: string | null;
  url: string | null;
  /** Il testo di `<known_participants>`, com'è. */
  participantsRaw: string;
  participants: GranolaParticipant[];
}

export interface GranolaSearchPage {
  meetings: GranolaMeetingHead[];
  /** Ci sono altre pagine (o la risposta dice che non è completa). */
  hasMore: boolean;
  nextCursor: string | null;
}

export interface GranolaMeetingNote extends GranolaMeetingHead {
  summary: string | null;
  privateNotes: string | null;
}

// ─── Etichette ───────────────────────────────────────────────────────

const ENTITY = /&(#x[0-9a-f]{1,6}|#\d{1,7}|amp|lt|gt|quot|apos);/gi;

/** Le entità XML (`&amp;`, `&quot;`, `&#39;`…) come caratteri. Un'entità sconosciuta o non valida resta com'è. */
export function decodeEntities(text: string): string {
  return text.replace(ENTITY, (whole, entity: string) => {
    const key = entity.toLowerCase();
    if (key === "amp") return "&";
    if (key === "lt") return "<";
    if (key === "gt") return ">";
    if (key === "quot") return '"';
    if (key === "apos") return "'";
    const code = key.startsWith("#x") ? Number.parseInt(key.slice(2), 16) : Number.parseInt(key.slice(1), 10);
    const valid = Number.isInteger(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff);
    return valid ? String.fromCodePoint(code) : whole;
  });
}

interface OpenTag {
  name: string;
  attrs: Record<string, string>;
  selfClosing: boolean;
  /** Dove comincia `<`. */
  start: number;
  /** Subito dopo `>`. */
  end: number;
}

const TAG_NAME = /[A-Za-z_][\w.-]*/y;
const ATTR_NAME = /[A-Za-z_:][\w:.-]*/y;
const UNQUOTED = /[^\s>]+/y;
const SPACE = /\s/;

/** L'etichetta d'apertura che comincia in `start` (un `<`), con i suoi attributi; le virgolette proteggono `>`. null se è rotta. */
function readOpenTag(text: string, start: number): OpenTag | null {
  if (text[start] !== "<") return null;
  TAG_NAME.lastIndex = start + 1;
  const tagName = TAG_NAME.exec(text);
  if (!tagName) return null;
  let pos = TAG_NAME.lastIndex;
  const attrs: Record<string, string> = {};
  while (pos < text.length) {
    while (pos < text.length && SPACE.test(text[pos])) pos++;
    if (text[pos] === ">") return { name: tagName[0].toLowerCase(), attrs, selfClosing: false, start, end: pos + 1 };
    if (text[pos] === "/" && text[pos + 1] === ">") return { name: tagName[0].toLowerCase(), attrs, selfClosing: true, start, end: pos + 2 };
    ATTR_NAME.lastIndex = pos;
    const attrName = ATTR_NAME.exec(text);
    if (!attrName) return null;
    pos = ATTR_NAME.lastIndex;
    while (pos < text.length && SPACE.test(text[pos])) pos++;
    const key = attrName[0].toLowerCase();
    if (text[pos] !== "=") {
      // Un attributo senza valore (`<pagination has_more />`): vale «presente».
      if (!Object.hasOwn(attrs, key)) attrs[key] = "";
      continue;
    }
    pos++;
    while (pos < text.length && SPACE.test(text[pos])) pos++;
    const quote = text[pos];
    let value: string;
    if (quote === '"' || quote === "'") {
      const close = text.indexOf(quote, pos + 1);
      if (close < 0) return null;
      value = text.slice(pos + 1, close);
      pos = close + 1;
    } else {
      UNQUOTED.lastIndex = pos;
      const bare = UNQUOTED.exec(text);
      if (!bare) return null;
      // `<x a=b/>`: la barra finale non fa parte del valore.
      value = bare[0].endsWith("/") && text[UNQUOTED.lastIndex] === ">" ? bare[0].slice(0, -1) : bare[0];
      pos = pos + value.length;
    }
    if (!Object.hasOwn(attrs, key)) attrs[key] = decodeEntities(value);
  }
  return null;
}

interface Element {
  attrs: Record<string, string>;
  /** Il testo tra apertura e chiusura, com'è (vuoto per un'etichetta che si chiude da sola). */
  inner: string;
  start: number;
  end: number;
}

/** Gli elementi `<name …>…</name>` (o `<name … />`) del testo, nell'ordine. Senza chiusura, l'elemento arriva fino al prossimo `<name` o alla fine. */
function elements(text: string, name: string): Element[] {
  const out: Element[] = [];
  const open = new RegExp(`<${name}(?=[\\s/>])`, "gi");
  const closeTag = `</${name}>`;
  const lower = text.toLowerCase();
  let match: RegExpExecArray | null;
  while ((match = open.exec(text)) !== null) {
    const tag = readOpenTag(text, match.index);
    if (!tag) continue;
    if (tag.selfClosing) {
      out.push({ attrs: tag.attrs, inner: "", start: tag.start, end: tag.end });
      open.lastIndex = tag.end;
      continue;
    }
    let close = lower.indexOf(closeTag, tag.end);
    let end: number;
    if (close < 0) {
      open.lastIndex = tag.end;
      const next = open.exec(text);
      close = next ? next.index : text.length;
      end = close;
    } else {
      end = close + closeTag.length;
    }
    out.push({ attrs: tag.attrs, inner: text.slice(tag.end, close), start: tag.start, end });
    open.lastIndex = end;
  }
  return out;
}

/** Il primo elemento `name` del testo, o null. */
function firstElement(text: string, name: string): Element | null {
  return elements(text, name)[0] ?? null;
}

/** Toglie i blocchi `<name>…</name>` e le etichette `<name … />` del testo. */
function withoutBlocks(text: string, names: readonly string[]): string {
  let out = text;
  for (const name of names) {
    const found = elements(out, name);
    for (let i = found.length - 1; i >= 0; i--) out = out.slice(0, found[i].start) + out.slice(found[i].end);
  }
  return out;
}

/** I blocchi che non sono call da leggere. */
const NOT_MEETINGS = ["upcoming_meetings", "omitted_meetings", "duplicate_recordings"] as const;

// ─── Valori ──────────────────────────────────────────────────────────

/** Un istante ISO, o null se la data non si legge. */
function isoOrNull(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value.trim());
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Un testo già decodificato (un attributo, un valore JSON): a capo di un tipo solo, niente spazi in testa e in coda. Vuoto → null. */
function trimText(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\r\n?/g, "\n").trim();
  return text ? text : null;
}

/** Il testo dentro un'etichetta: entità decodificate, poi come `trimText`. */
function cleanText(value: string | null | undefined): string | null {
  return typeof value === "string" ? trimText(decodeEntities(value)) : null;
}

/** Un testo già decodificato su una riga sola. */
function oneLineText(value: string | null | undefined): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

/** Un id di una call: niente spazi, al massimo 120 caratteri (la colonna). Le call future (`evt_…`) non contano. */
function meetingId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim();
  if (!id || id.length > 120 || /\s/.test(id) || /^evt_/i.test(id)) return null;
  return id;
}

const TRUE_WORDS = new Set(["", "true", "1", "yes", "si", "sì"]);

// ─── Partecipanti ────────────────────────────────────────────────────

const EMAIL = /[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;

/** Divide su virgole, punti e virgola e a capo fuori da parentesi tonde, quadre e angolari. */
function splitOutside(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of text) {
    if (char === "(" || char === "[" || char === "<") depth++;
    else if ((char === ")" || char === "]" || char === ">") && depth > 0) depth--;
    if (depth === 0 && (char === "," || char === ";" || char === "\n")) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts;
}

/**
 * I partecipanti di `<known_participants>`: «Nome Cognome (note creator) from Azienda (nome@esempio.it),
 * altra@esempio.it». Si divide sulle virgole fuori dalle parentesi; l'e-mail si prende ovunque sia.
 */
export function parseParticipants(raw: string): GranolaParticipant[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  const out: GranolaParticipant[] = [];
  for (const piece of splitOutside(raw)) {
    const part = piece.replace(/^\s*[-*•]\s+/, "").trim();
    if (!part) continue;
    const email = EMAIL.exec(part)?.[0].toLowerCase() ?? null;
    const noteCreator = /\(\s*note[\s_-]*creator\s*\)/i.test(part);
    const company = /\bfrom\s+([^()<>[\]]+?)\s*(?:[([<]|$)/i.exec(part)?.[1].trim() || null;
    const name =
      part
        .replace(/\([^)]*\)|\[[^\]]*\]|<[^>]*>/g, " ")
        .replace(/\bfrom\s+[^()<>[\]]+$/i, " ")
        .replace(new RegExp(EMAIL.source, "g"), " ")
        .replace(/\s+/g, " ")
        .trim() || null;
    if (!name && !email) continue;
    out.push({ name, email, company, noteCreator });
  }
  return out;
}

// ─── Call ────────────────────────────────────────────────────────────

function headFrom(attrs: Record<string, string>, inner: string): GranolaMeetingHead | null {
  const id = meetingId(attrs.id);
  if (!id) return null;
  const known = firstElement(inner, "known_participants");
  const participantsRaw = known ? (cleanText(known.inner) ?? "") : (trimText(attrs.participants) ?? "");
  return {
    id,
    title: oneLineText(attrs.title),
    meetingAt: isoOrNull(attrs.meeting_at ?? attrs.date ?? attrs.start),
    updatedAt: isoOrNull(attrs.updated_at),
    url: trimText(attrs.url),
    participantsRaw,
    participants: parseParticipants(participantsRaw),
  };
}

function noteFrom(attrs: Record<string, string>, inner: string): GranolaMeetingNote | null {
  const head = headFrom(attrs, inner);
  if (!head) return null;
  const summary = firstElement(inner, "summary");
  const notes = firstElement(inner, "private_notes");
  const notesStatus = (notes?.attrs.status ?? "").toLowerCase();
  return {
    ...head,
    summary: summary ? cleanText(summary.inner) : null,
    privateNotes: notes && notesStatus !== "empty" && notesStatus !== "not_included" ? cleanText(notes.inner) : null,
  };
}

/** Il testo come JSON, se lo è; altrimenti null. */
function asJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
}

type JsonRecord = Record<string, unknown>;
const isRecord = (value: unknown): value is JsonRecord => typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): string | undefined => (typeof value === "string" ? value : typeof value === "number" ? String(value) : undefined);

/** Le call di una risposta in JSON (riserva): `meetings: [{ id, title, meeting_at, updated_at, url, … }]`. */
function jsonMeetings(json: unknown): JsonRecord[] {
  if (Array.isArray(json)) return json.filter(isRecord);
  if (!isRecord(json)) return [];
  for (const key of ["meetings", "notes", "results", "data"]) {
    const value = json[key];
    if (Array.isArray(value)) return value.filter(isRecord);
  }
  return [];
}

function jsonAttrs(item: JsonRecord): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const key of ["id", "title", "meeting_at", "updated_at", "url"]) {
    const value = str(item[key]);
    if (value !== undefined) attrs[key] = value;
  }
  const participants = item.known_participants ?? item.participants;
  if (typeof participants === "string") attrs.participants = participants;
  else if (Array.isArray(participants)) {
    attrs.participants = participants
      .map((p) => (typeof p === "string" ? p : isRecord(p) ? [str(p.name), str(p.email) ? `(${str(p.email)})` : ""].filter(Boolean).join(" ") : ""))
      .filter(Boolean)
      .join(", ");
  }
  return attrs;
}

/** La pagina di `search_meetings`: le call (senza quelle future) e la paginazione. */
export function parseSearchMeetings(text: string): GranolaSearchPage {
  const empty: GranolaSearchPage = { meetings: [], hasMore: false, nextCursor: null };
  if (typeof text !== "string" || !text) return empty;
  try {
    const json = asJson(text);
    if (json !== null) {
      const meetings = jsonMeetings(json)
        .map((item) => headFrom(jsonAttrs(item), ""))
        .filter((m): m is GranolaMeetingHead => m !== null);
      const record = isRecord(json) ? json : {};
      const pagination = isRecord(record.pagination) ? record.pagination : record;
      const nextCursor = str(pagination.next_cursor)?.trim() || null;
      const hasMore = pagination.has_more === true || String(pagination.has_more).toLowerCase() === "true" || nextCursor !== null || pagination.completion_status === "incomplete";
      return { meetings: dedupe(meetings), hasMore, nextCursor };
    }
    const body = withoutBlocks(text, NOT_MEETINGS);
    const meetings = elements(body, "meeting")
      .map((el) => headFrom(el.attrs, el.inner))
      .filter((m): m is GranolaMeetingHead => m !== null);
    const pagination = firstElement(body, "pagination");
    const cursorAttr = pagination?.attrs.next_cursor;
    const nextCursor = (cursorAttr ?? cleanText(firstElement(body, "next_cursor")?.inner) ?? "").trim() || null;
    const hasMoreAttr = pagination?.attrs.has_more;
    const incomplete = /completion_status\s*[=:]\s*["']?\s*incomplete/i.test(body);
    const hasMore = (hasMoreAttr !== undefined ? TRUE_WORDS.has(hasMoreAttr.trim().toLowerCase()) : nextCursor !== null) || incomplete;
    return { meetings: dedupe(meetings), hasMore, nextCursor };
  } catch {
    return empty;
  }
}

/** Le note di `get_meetings`: titolo, data, partecipanti, il riassunto di Granola e le note private di chi ha collegato. */
export function parseGetMeetings(text: string): GranolaMeetingNote[] {
  if (typeof text !== "string" || !text) return [];
  try {
    const json = asJson(text);
    if (json !== null) {
      return dedupe(
        jsonMeetings(json)
          .map((item) => {
            const head = headFrom(jsonAttrs(item), "");
            if (!head) return null;
            const notes = item.private_notes;
            return {
              ...head,
              summary: trimText(str(item.summary)),
              privateNotes: typeof notes === "string" ? trimText(notes) : isRecord(notes) ? trimText(str(notes.text)) : null,
            };
          })
          .filter((m): m is GranolaMeetingNote => m !== null),
      );
    }
    const body = withoutBlocks(text, NOT_MEETINGS);
    return dedupe(
      elements(body, "meeting")
        .map((el) => noteFrom(el.attrs, el.inner))
        .filter((m): m is GranolaMeetingNote => m !== null),
    );
  } catch {
    return [];
  }
}

/** Una call per id: la prima vince. */
function dedupe<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => (seen.has(item.id) ? false : (seen.add(item.id), true)));
}

// ─── Cartelle, account, trascrizione ─────────────────────────────────

const FOLDER_ID = /^[A-Za-z0-9_.:-]{1,120}$/;

/** Le cartelle di `list_meeting_folders`: `<folder id name>`, JSON, o righe «Nome (id: …)». */
export function parseFolders(text: string): Array<{ id: string; name: string }> {
  if (typeof text !== "string" || !text) return [];
  const out: Array<{ id: string; name: string }> = [];
  const push = (id: unknown, name: unknown) => {
    const cleanId = typeof id === "string" || typeof id === "number" ? String(id).trim() : "";
    const cleanName = typeof name === "string" ? oneLineText(name).slice(0, 200) : "";
    if (!FOLDER_ID.test(cleanId) || out.some((f) => f.id === cleanId)) return;
    out.push({ id: cleanId, name: cleanName || cleanId });
  };
  try {
    const json = asJson(text);
    if (json !== null) {
      const list = Array.isArray(json) ? json : isRecord(json) && Array.isArray(json.folders) ? json.folders : [];
      for (const item of list) if (isRecord(item)) push(item.id ?? item.folder_id, item.name ?? item.title);
      return out;
    }
    for (const el of elements(text, "folder")) push(el.attrs.id ?? el.attrs.folder_id, el.attrs.name ?? el.attrs.title ?? decodeEntities(el.inner.trim().split("\n")[0]));
    if (out.length === 0) {
      for (const line of text.split("\n")) {
        const found = /^\s*[-*•]?\s*(.+?)\s*[([]\s*(?:folder_)?id\s*[:=]\s*([A-Za-z0-9_.:-]+)\s*[)\]]\s*$/i.exec(line);
        if (found) push(found[2], found[1]);
      }
    }
  } catch {
    // Un testo rotto non lancia: le cartelle lette fin qui.
  }
  return out;
}

const PLAN_MAX = 40;

/** E-mail e piano di `get_account_info`: prima il JSON, poi le etichette, poi le righe «chiave: valore». */
export function parseAccountInfo(text: string): { email: string | null; plan: string | null } {
  const result = { email: null as string | null, plan: null as string | null };
  if (typeof text !== "string" || !text) return result;
  const setEmail = (value: unknown) => {
    if (result.email || typeof value !== "string") return;
    const found = EMAIL.exec(value.trim());
    if (found && found[0].length <= 320) result.email = found[0].toLowerCase();
  };
  const setPlan = (value: unknown) => {
    if (result.plan || typeof value !== "string") return;
    const plan = oneLineText(value).slice(0, PLAN_MAX);
    if (plan) result.plan = plan;
  };
  try {
    const json = asJson(text);
    if (isRecord(json)) {
      const account = isRecord(json.account) ? json.account : isRecord(json.user) ? json.user : json;
      for (const key of ["email", "user_email", "account_email"]) setEmail(account[key] ?? json[key]);
      for (const key of ["plan", "plan_name", "subscription", "tier"]) {
        const value = account[key] ?? json[key];
        setPlan(isRecord(value) ? (value.name ?? value.type) : value);
      }
    }
    if (!result.email || !result.plan) {
      const account = firstElement(text, "account") ?? firstElement(text, "user");
      if (account) {
        setEmail(account.attrs.email);
        setPlan(account.attrs.plan);
      }
      for (const name of ["email", "user_email", "account_email"]) setEmail(cleanText(firstElement(text, name)?.inner));
      for (const name of ["plan", "plan_name", "subscription", "tier"]) setPlan(cleanText(firstElement(text, name)?.inner));
    }
    if (!result.email || !result.plan) {
      for (const line of text.split("\n")) {
        const pair = /^\s*[-*•]?\s*([A-Za-z_ -]{2,30}?)\s*[:=]\s*(.+?)\s*$/.exec(line);
        if (!pair) continue;
        const key = pair[1].trim().toLowerCase().replace(/[\s-]+/g, "_");
        if (["email", "e_mail", "user_email", "account_email"].includes(key)) setEmail(pair[2]);
        if (["plan", "plan_name", "subscription", "tier", "piano"].includes(key)) setPlan(pair[2]);
      }
    }
  } catch {
    // Quello che si è letto fin qui.
  }
  return result;
}

/**
 * Un pezzo di `get_meeting_transcript`: il testo, dove riprendere (`next_offset`), e se la trascrizione non c'è
 * (`transcript_unavailable`, oppure `transcript` nullo). Prima il JSON, poi le etichette, poi le righe «chiave: valore».
 */
export function parseTranscript(text: string): { text: string | null; nextOffset: number | null; unavailable: boolean } {
  const result = { text: null as string | null, nextOffset: null as number | null, unavailable: false };
  if (typeof text !== "string" || !text) return { ...result, unavailable: true };
  const offset = (value: unknown): number | null => {
    const n = typeof value === "number" ? value : typeof value === "string" && /^\d{1,9}$/.test(value.trim()) ? Number(value.trim()) : NaN;
    return Number.isInteger(n) && n > 0 ? n : null;
  };
  try {
    const json = asJson(text);
    if (isRecord(json)) {
      const transcript = json.transcript;
      // Un pezzo si tiene com'è, spazi compresi: i pezzi uniti ridanno la trascrizione.
      result.text = typeof transcript === "string" && transcript.trim() ? transcript.replace(/\r\n?/g, "\n") : null;
      result.nextOffset = offset(json.next_offset);
      result.unavailable = json.transcript_unavailable !== undefined && json.transcript_unavailable !== null && json.transcript_unavailable !== false ? true : transcript === null;
      if (json.truncated === false) result.nextOffset = null;
      return result;
    }
    const tagged = firstElement(text, "transcript");
    if (tagged) {
      const inner = decodeEntities(tagged.inner).replace(/\r\n?/g, "\n");
      result.text = tagged.attrs.status === "unavailable" || !inner.trim() ? null : inner;
      result.nextOffset = offset(tagged.attrs.next_offset ?? firstElement(text, "next_offset")?.inner);
      result.unavailable = /transcript_unavailable|status\s*=\s*["']unavailable/i.test(text) || result.text === null;
      return result;
    }
    if (/transcript_unavailable|no transcript|transcript (?:is )?(?:not available|unavailable)/i.test(text)) return { text: null, nextOffset: null, unavailable: true };
    const next = /^\s*next_offset\s*[:=]\s*(\d{1,9})\s*$/im.exec(text);
    result.nextOffset = next ? offset(next[1]) : null;
    result.text = cleanText(text.replace(/^\s*(?:next_offset|total_chars|truncated)\s*[:=].*$/gim, ""));
    result.unavailable = result.text === null;
  } catch {
    return { text: null, nextOffset: null, unavailable: true };
  }
  return result;
}
