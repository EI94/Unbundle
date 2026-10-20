/**
 * Windows-1252 («ANSI» di Excel e di Windows) decodificato a mano.
 *
 * `TextDecoder("windows-1252")` di Node tratta l'etichetta come ISO-8859-1:
 * i byte 0x80–0x9F diventano caratteri di controllo invece di €, “ ” – — e
 * simili. Qui la tabella è quella vera; i cinque byte senza carattere
 * restano caratteri di controllo C1 (e così contano come non stampabili).
 *
 * Modulo puro.
 */

/** Caratteri dei byte 0x80–0x9F; `null` = non assegnato. */
const HIGH: readonly (string | null)[] = [
  "€", null, "‚", "ƒ", "„", "…", "†", "‡", "ˆ", "‰", "Š", "‹", "Œ", null, "Ž", null,
  null, "‘", "’", "“", "”", "•", "–", "—", "˜", "™", "š", "›", "œ", null, "ž", "Ÿ",
];

let table: string[] | null = null;

/** I 256 caratteri di Windows-1252, per indice di byte. */
export function windows1252Table(): readonly string[] {
  if (!table) {
    table = [];
    for (let b = 0; b < 256; b++) table.push(b >= 0x80 && b <= 0x9f ? (HIGH[b - 0x80] ?? String.fromCharCode(b)) : String.fromCharCode(b));
  }
  return table;
}

/** Testo da byte in Windows-1252. */
export function decodeWindows1252(bytes: Uint8Array): string {
  const map = windows1252Table();
  const parts: string[] = [];
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    let piece = "";
    const end = Math.min(bytes.length, i + CHUNK);
    for (let k = i; k < end; k++) piece += map[bytes[k]];
    parts.push(piece);
  }
  return parts.join("");
}
