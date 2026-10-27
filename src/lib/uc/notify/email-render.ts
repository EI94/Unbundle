/**
 * Il motore di composizione delle email (spostato da `email-templates.ts`): testo semplice più HTML
 * minimo, **nessuna immagine, nessun pixel, nessuna risorsa esterna**, un pulsante per il link più
 * l'indirizzo in chiaro, e il piè di pagina «Lateral Space via Unbundle.». Lo usano le email dei
 * dossier (`email-templates.ts`, che lo riesporta com'era) e quelle di «Chiedi al referente»
 * (`src/lib/use-cases/referent/email.ts`, `alerts.ts`). Il testo generato non cambia di un byte.
 *
 * Modulo puro.
 */
import { ROME_TZ } from "./schedule.ts";

export const UC_EMAIL_SENDER_NAME = "Lateral Space via Unbundle";

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

export function render(subject: string, blocks: Block[]): RenderedEmail {
  const text: string[] = [];
  const html: string[] = [];
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
