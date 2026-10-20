/**
 * Testi degli utenti dentro le notifiche: si mostrano, non si eseguono.
 *
 * Titoli e descrizioni delle segnalazioni arrivano da persone esterne (connettore
 * Claude, REST, Slack). Prima di finire in una notifica:
 *  - email (HTML): escape di & < > " ' (nessun tag o attributo iniettato);
 *  - Slack (mrkdwn): escape di & < > (quindi niente `<!channel>`, `<!here>`,
 *    `<!everyone>`, `<@U…>` o link mascherati scritti dall'utente) e `@parola`
 *    spezzata con uno spazio di larghezza zero, perché l'adattatore Slack
 *    trasforma `@nome` in una menzione `<@nome>` (vale anche per @channel e @here);
 *  - testo semplice (webhook): solo menzioni neutralizzate e caratteri di
 *    controllo tolti.
 * Modulo puro: lo usano le notifiche e i test con Node.
 */

const ZERO_WIDTH_SPACE = "​";

export function escapeHtml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** `@channel`, `@here`, `@everyone` e ogni `@parola` smettono di essere menzioni. */
export function neutralizeMentions(text: string) {
  return text.replace(/@(?=[\p{L}\p{N}_])/gu, `@${ZERO_WIDTH_SPACE}`);
}

function stripControlChars(text: string) {
  // Caratteri di controllo tolti, tranne a capo e tab.
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

/** Testo dell'utente dentro un messaggio Slack (mrkdwn). */
export function escapeSlackText(text: string) {
  return neutralizeMentions(
    stripControlChars(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  );
}

/** Testo dell'utente dentro un testo semplice (webhook, relay WhatsApp). */
export function plainNotificationText(text: string) {
  return neutralizeMentions(stripControlChars(text));
}
