/**
 * Il motore di composizione delle email (spostato da `email-templates.ts`): testo semplice più HTML
 * minimo, **nessun pixel di tracciamento**, un pulsante per il link più l'indirizzo in chiaro, e il
 * piè di pagina «Lateral Space via Unbundle.». Lo usano le email dei dossier (`email-templates.ts`,
 * che lo riesporta com'era: nessuna immagine, il testo generato non cambia di un byte) e quelle
 * dell'area «Use case» (`src/lib/use-cases/referent/email.ts`, `alerts.ts`, `case-alerts/email.ts`).
 *
 * (Rilascio 5.1) Con `brand` (le email dell'area «Use case») l'HTML comincia con un'intestazione: il
 * marchio «U» di Unbundle, un'immagine statica del sito (`UC_EMAIL_LOGO_PATH`, lo stesso indirizzo
 * assoluto per tutti, senza parametri: non dice a nessuno chi ha aperto l'email), con il testo
 * alternativo «Unbundle» e accanto, in testo, «Lateral Space via Unbundle»: con le immagini bloccate
 * si legge lo stesso. Senza un indirizzo pubblico valido solo il testo. Il testo semplice non cambia.
 *
 * Modulo puro.
 */
import { ROME_TZ } from "./schedule.ts";

export const UC_EMAIL_SENDER_NAME = "Lateral Space via Unbundle";

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

/** L'intestazione HTML: il marchio (se c'è l'indirizzo) e «Lateral Space via Unbundle» in testo. */
function brandHeader(brand: EmailBrand): string {
  const logo = brand.logoUrl
    ? `<td style="vertical-align:middle;padding:0 10px 0 0"><img src="${escapeHtml(brand.logoUrl)}" width="${UC_EMAIL_LOGO_SIZE}" height="${UC_EMAIL_LOGO_SIZE}" alt="${escapeHtml(UC_EMAIL_LOGO_ALT)}" style="display:block;width:${UC_EMAIL_LOGO_SIZE}px;height:${UC_EMAIL_LOGO_SIZE}px;border:0;border-radius:6px"></td>`
    : "";
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;border-collapse:collapse"><tr>` +
    logo +
    `<td style="vertical-align:middle;font-size:15px;font-weight:bold;color:#111827">${escapeHtml(UC_EMAIL_SENDER_NAME)}</td>` +
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
      html.push(
        `<p style="margin:0 0 16px"><a href="${escapeHtml(b.link.href)}" style="display:inline-block;padding:12px 18px;background:#111827;color:#ffffff;text-decoration:none;border-radius:6px">${escapeHtml(b.link.label)}</a></p>`,
        `<p style="margin:0 0 16px;font-size:13px;color:#4b5563;word-break:break-all">${escapeHtml(b.link.href)}</p>`,
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
  const footer = `${UC_EMAIL_SENDER_NAME}.`;
  text.push("--", footer);
  html.push(`<p style="margin:24px 0 0;font-size:12px;color:#9ca3af">${escapeHtml(footer)}</p>`);
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
