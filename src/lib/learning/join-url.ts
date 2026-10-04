import "server-only";
import { headers } from "next/headers";
import QRCode from "qrcode";

/**
 * Base URL per i link di corso.
 *
 * Lo stesso calcolo esiste in tre action (workspace, workspace-collaboration,
 * ai-readiness): qui sta in un posto solo perche' il codice nuovo non aggiunga
 * una quarta copia. I tre chiamanti esistenti non sono stati toccati.
 */
function normalize(value: string | undefined | null) {
  if (!value) return null;
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  return /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export async function learningBaseUrl() {
  const configured =
    normalize(process.env.NEXT_PUBLIC_APP_URL) ??
    normalize(process.env.APP_URL) ??
    normalize(process.env.VERCEL_PROJECT_PRODUCTION_URL) ??
    normalize(process.env.VERCEL_URL);
  if (configured) return configured;
  const headerStore = await headers();
  const host = headerStore.get("host") ?? "localhost:3000";
  const proto = headerStore.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}

/**
 * QR del link, da proiettare in aula.
 *
 * In aula venti persone devono entrare insieme: digitare un indirizzo sul
 * telefono e' il passaggio piu' lento e quello in cui si sbaglia. Correzione
 * d'errore media: regge la foto di uno schermo da lontano senza gonfiare il
 * disegno.
 */
export async function joinQrSvg(url: string) {
  return QRCode.toString(url, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 1,
    width: 320,
  });
}
