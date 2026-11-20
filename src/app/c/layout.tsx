import type { Viewport } from "next";
import { PublicRoot } from "@/components/public/public-shell";
import { PUBLIC_VIEWPORT } from "@/lib/public/page";

/**
 * (Rilascio 10, ondata 4, PROPOSTA-10 §3.11) Il link di un corso (`/c/<token>`) è una pagina fuori dalla dashboard:
 * chiara, resa dal server (`.survey-light`), anche nella scheda d'errore e in quella di un link che non vale. Dentro
 * nessun componente con portale. I metadati (anteprima nelle chat, `noindex`) li dà la pagina.
 */
export const viewport: Viewport = PUBLIC_VIEWPORT;

export default function CourseLinkLayout({ children }: { children: React.ReactNode }) {
  return <PublicRoot>{children}</PublicRoot>;
}
