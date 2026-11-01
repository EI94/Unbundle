/**
 * La chiave privata dell'account di servizio Firebase, com'è scritta in
 * FIREBASE_ADMIN_PRIVATE_KEY, riportata a un PEM che `cert()` accetta.
 *
 * firebase-admin 13.8 leggeva la chiave con node-forge, che ignora gli a capo e
 * gli spazi dentro il PEM e il testo intorno ai marcatori; dalla 13.10 la legge
 * `createPrivateKey` di node:crypto (OpenSSL), che vuole la riga BEGIN da sola e
 * il base64 su righe proprie. Una chiave salvata senza a capo
 * («-----BEGIN PRIVATE KEY-----MIIE…-----END PRIVATE KEY-----») passava con la
 * 13.8 e con la 13.10 fa fallire `cert()` all'import di admin.ts, cioè ogni
 * route di sessione. Qui:
 * - i `\n` letterali diventano a capo e i CR spariscono;
 * - le virgolette intorno al valore (una chiave copiata dal JSON) si tolgono;
 * - se il corpo tra BEGIN ed END non sta su righe proprie di al più 64
 *   caratteri, si ricostruisce il PEM standard: riga BEGIN, base64 a 64
 *   caratteri per riga, riga END, a capo finale. I marcatori restano quelli
 *   scritti (anche «RSA PRIVATE KEY», PKCS#1).
 * Una chiave già standard esce identica byte per byte. Una chiave senza
 * marcatori, o con nel corpo caratteri che non sono base64 (per esempio le
 * intestazioni di un PEM cifrato), esce senza ricostruzione e `cert()` dà il suo
 * errore, come prima.
 */

/** Il primo blocco PEM, con l'etichetta come la legge node-forge. */
const PEM_BLOCK = /-----BEGIN ([A-Z0-9- ]+)-----([\s\S]*?)-----END \1-----/;

/**
 * Un PEM che ogni OpenSSL legge così com'è: marcatori su righe proprie, base64
 * su righe di al più 64 caratteri, senza spazi.
 */
const STANDARD_PEM = /^\n*-----BEGIN ([A-Z0-9- ]+)-----\n(?:[A-Za-z0-9+/=]{1,64}\n)+-----END \1-----\n*$/;

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  const quote = trimmed[0];
  if (trimmed.length >= 2 && (quote === '"' || quote === "'") && trimmed.endsWith(quote)) {
    return trimmed.slice(1, -1);
  }
  return value;
}

export function normalizeServiceAccountKey(raw: string): string {
  const key = stripQuotes(raw.replace(/\\n/g, "\n").replace(/\r/g, ""));
  if (STANDARD_PEM.test(key)) return key;

  const block = PEM_BLOCK.exec(key);
  if (!block) return key;
  const [, label, inner] = block;
  const body = inner.replace(/\s+/g, "");
  if (!BASE64.test(body)) return key;

  const lines = body.match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----\n`;
}
