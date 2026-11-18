/**
 * Il motore di composizione delle email (spostato da `email-templates.ts`): testo semplice più HTML
 * minimo, **nessun pixel di tracciamento**, un pulsante per il link. Lo usano le email dei dossier
 * (`email-templates.ts`) e quelle dell'area «Use case» (`src/lib/use-cases/referent/email.ts`,
 * `alerts.ts`, `case-alerts/email.ts`).
 *
 * (Rilascio 5.1) Con `brand` l'HTML comincia con un'intestazione: il marchio «U» di Unbundle,
 * un'immagine statica del sito (`UC_EMAIL_LOGO_PATH`, lo stesso indirizzo assoluto per tutti, senza
 * parametri: non dice a nessuno chi ha aperto l'email), con il testo alternativo «Unbundle» e accanto,
 * in testo, «Unbundle»: con le immagini bloccate si legge lo stesso. Senza un indirizzo pubblico
 * valido solo il testo.
 *
 * (Rilascio 10, §3.12) Il modello unico: il marchio una volta sola, il mittente e l'intestazione (niente
 * piè di pagina «Lateral Space via Unbundle.»); l'indirizzo del link in chiaro solo nel testo
 * semplice, mai sotto il pulsante dell'HTML; l'oggetto al massimo di 55 caratteri, «{Cliente}: {cosa}
 * «{Titolo}»», senza il codice (`emailSubject`); il corpo al massimo di 60 parole (`emailBodyWords`).
 *
 * Modulo puro.
 */
import { ROME_TZ } from "./schedule.ts";

/** Il mittente delle email («Da»): lo mostra l'anteprima di «Controlla e invia». */
export const UC_EMAIL_SENDER_NAME = "Lateral Space via Unbundle";

/** (Rilascio 10, §3.12) Il testo dell'intestazione accanto al marchio: il nome del prodotto, una volta. */
export const UC_EMAIL_BRAND_TEXT = "Unbundle";

/** (Rilascio 10, §3.12, D6) L'oggetto al massimo di 55 caratteri: al telefono si legge per intero. */
export const EMAIL_SUBJECT_MAX = 55;
/** (Rilascio 10, §3.12) Il corpo al massimo di 60 parole: saluto, chi e che cosa, quanto ci vuole, il pulsante, una riga piccola. */
export const EMAIL_BODY_MAX_WORDS = 60;
/** Il titolo nell'oggetto non scende sotto questi caratteri: si accorcia prima il nome del cliente… */
const SUBJECT_TITLE_MIN = 14;
/** …ma non sotto questi: il nome del cliente apre l'oggetto e deve restare leggibile. */
const SUBJECT_COMPANY_MIN = 16;

/** (Rilascio 5.1) Il marchio «U» delle email: un file statico di `public/` (lo rifà `scripts/render-email-logo.mjs`). */
export const UC_EMAIL_LOGO_PATH = "/email/unbundle-u.png";
/** Il testo alternativo del marchio, quando l'immagine non si carica. */
export const UC_EMAIL_LOGO_ALT = "Unbundle";
/** Il lato del marchio a schermo, in pixel CSS (il file è 96×96, nitido anche a 3×). */
export const UC_EMAIL_LOGO_SIZE = 32;

/** (Rilascio 5.1) L'intestazione delle email dell'area «Use case»: l'indirizzo assoluto del marchio, o null. */
export interface EmailBrand {
  logoUrl: string | null;
}

const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|[a-z0-9-]+\.localhost)$/i;

/**
 * L'intestazione per l'origine pubblica dell'app (`emailOrigin`, da `NEXT_PUBLIC_APP_URL`): il marchio
 * con un indirizzo assoluto https (http solo in locale), senza credenziali, parametri o frammenti.
 */
export function emailBrand(origin: string | null | undefined): EmailBrand {
  if (!origin) return { logoUrl: null };
  try {
    const url = new URL(origin);
    const allowed = url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK_HOST.test(url.hostname));
    if (!allowed || url.username || url.password) return { logoUrl: null };
    return { logoUrl: `${url.origin}${UC_EMAIL_LOGO_PATH}` };
  } catch {
    return { logoUrl: null };
  }
}

/** L'intestazione HTML: il marchio (se c'è l'indirizzo) e «Unbundle» in testo. */
function brandHeader(brand: EmailBrand): string {
  const logo = brand.logoUrl
    ? `<td style="vertical-align:middle;padding:0 10px 0 0"><img src="${escapeHtml(brand.logoUrl)}" width="${UC_EMAIL_LOGO_SIZE}" height="${UC_EMAIL_LOGO_SIZE}" alt="${escapeHtml(UC_EMAIL_LOGO_ALT)}" style="display:block;width:${UC_EMAIL_LOGO_SIZE}px;height:${UC_EMAIL_LOGO_SIZE}px;border:0;border-radius:6px"></td>`
    : "";
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;border-collapse:collapse"><tr>` +
    logo +
    `<td style="vertical-align:middle;font-size:15px;font-weight:bold;color:#111827">${escapeHtml(UC_EMAIL_BRAND_TEXT)}</td>` +
    `</tr></table>`
  );
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

const DATE_IT = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "long", year: "numeric", timeZone: ROME_TZ });

export function formatDateIt(d: Date): string {
  return DATE_IT.format(d);
}

export function oneLine(s: string, max: number): string {
  const clean = s.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/** (Rilascio 10, §3.12) «26 novembre», senza l'anno: i link valgono al massimo qualche settimana. */
const DAY_MONTH_IT = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "long", timeZone: ROME_TZ });

export function formatDayMonthIt(d: Date): string {
  return DAY_MONTH_IT.format(d);
}

const DAY_ONLY_IT = new Intl.DateTimeFormat("it-IT", { day: "numeric", timeZone: ROME_TZ });

/**
 * (Rilascio 10, §3.12) Il giorno con la preposizione, come si legge: «fino al 26 novembre», ma «fino
 * all'8 dicembre» (così l'1 e l'11); «entro il 26 novembre», ma «entro l'8 dicembre».
 */
export function untilDayIt(d: Date): string {
  return ["1", "8", "11"].includes(DAY_ONLY_IT.format(d)) ? `fino all'${formatDayMonthIt(d)}` : `fino al ${formatDayMonthIt(d)}`;
}

export function byDayIt(d: Date): string {
  return ["1", "8", "11"].includes(DAY_ONLY_IT.format(d)) ? `entro l'${formatDayMonthIt(d)}` : `entro il ${formatDayMonthIt(d)}`;
}

/**
 * (Rilascio 10, §3.12, D6) L'oggetto di un'email: «{Cliente}: {cosa} «{Titolo}»», al massimo di
 * `EMAIL_SUBJECT_MAX` caratteri e mai con il codice dello use case. Il titolo viene per ultimo e si
 * accorcia con «…»; se non resta posto per almeno `SUBJECT_TITLE_MIN` caratteri del titolo, si
 * accorcia il nome del cliente, ma non sotto `SUBJECT_COMPANY_MIN`. Senza titolo: «{Cliente}: {cosa}».
 */
export function emailSubject(company: string, what: string, title?: string | null): string {
  // Accorcia senza lasciare uno spazio prima di «…».
  const cut = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value);
  const fullCompany = oneLine(company, 80);
  const head = oneLine(what, EMAIL_SUBJECT_MAX);
  const fullTitle = title ? oneLine(title, 200) : "";
  if (!fullTitle) {
    if (!fullCompany) return head;
    // Senza titolo si accorcia il nome del cliente, mai {cosa}: l'azione resta intera.
    const companyRoom = EMAIL_SUBJECT_MAX - 2 - head.length;
    return companyRoom >= 4 ? `${cut(fullCompany, companyRoom)}: ${head}` : cut(`${fullCompany}: ${head}`, EMAIL_SUBJECT_MAX);
  }
  // ": " prima di {cosa}, " «" e "»" intorno al titolo.
  const fixed = 2 + head.length + 3;
  const wantedTitle = Math.min(SUBJECT_TITLE_MIN, fullTitle.length);
  const companyRoom = Math.max(Math.min(SUBJECT_COMPANY_MIN, fullCompany.length), EMAIL_SUBJECT_MAX - fixed - wantedTitle);
  const client = cut(fullCompany, companyRoom);
  const room = EMAIL_SUBJECT_MAX - fixed - client.length;
  if (room < 4) return cut(`${client}: ${head}`, EMAIL_SUBJECT_MAX);
  return `${client}: ${head} «${cut(fullTitle, room)}»`;
}

/**
 * (Rilascio 10, §3.12) Le parole del corpo come le legge chi riceve l'email: il testo semplice senza
 * gli indirizzi dei link. Lo usano i test del modello (`EMAIL_BODY_MAX_WORDS`).
 */
export function emailBodyWords(text: string): number {
  return text
    .replace(/https?:\/\/\S+/g, " ")
    .split(/\s+/)
    .filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}

export function multiLine(s: string, max: number): string {
  const clean = s
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export type Block = { p: string } | { link: { href: string; label: string } } | { list: string[] } | { small: string } | { quote: string };

export function render(subject: string, blocks: Block[], brand?: EmailBrand): RenderedEmail {
  const text: string[] = [];
  const html: string[] = brand ? [brandHeader(brand)] : [];
  for (const b of blocks) {
    if ("p" in b) {
      text.push(b.p);
      html.push(`<p style="margin:0 0 16px">${escapeHtml(b.p)}</p>`);
    } else if ("link" in b) {
      text.push(`${b.link.label}: ${b.link.href}`);
      // (Rilascio 10, §3.12) L'indirizzo in chiaro solo nel testo semplice: nell'HTML basta il pulsante.
      html.push(
        `<p style="margin:0 0 16px"><a href="${escapeHtml(b.link.href)}" style="display:inline-block;padding:12px 18px;background:#111827;color:#ffffff;text-decoration:none;border-radius:6px">${escapeHtml(b.link.label)}</a></p>`,
      );
    } else if ("list" in b) {
      text.push(b.list.map((l) => `- ${l}`).join("\n"));
      html.push(`<ul style="margin:0 0 16px;padding-left:20px">${b.list.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul>`);
    } else if ("quote" in b) {
      text.push(b.quote.split("\n").map((l) => `> ${l}`).join("\n"));
      html.push(`<blockquote style="margin:0 0 16px;padding-left:12px;border-left:3px solid #d1d5db;white-space:pre-line">${escapeHtml(b.quote)}</blockquote>`);
    } else {
      text.push(b.small);
      html.push(`<p style="margin:0 0 12px;font-size:13px;color:#6b7280">${escapeHtml(b.small)}</p>`);
    }
  }
  // (Rilascio 10, §3.12) Niente piè di pagina con il marchio: lo dicono già il mittente e l'intestazione.
  return {
    subject,
    text: `${text.join("\n\n")}\n`,
    html:
      `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>` +
      `<body style="margin:0;padding:24px;background:#ffffff;color:#111827;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5">` +
      html.join("") +
      `</body></html>`,
  };
}
