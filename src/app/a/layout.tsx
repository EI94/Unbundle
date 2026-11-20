import type { Viewport } from "next";
import { PublicRoot } from "@/components/public/public-shell";
import { PUBLIC_VIEWPORT } from "@/lib/public/page";

/**
 * (Rilascio 10, ondata 4, PROPOSTA-10 §3.11, §5.1) Il questionario per chi risponde (`/a/<token>`) è una pagina fuori
 * dalla dashboard: chiara, resa dal server (`.survey-light`), anche nella scheda d'errore. Niente più interruttore del
 * tema. Dentro nessun componente con portale. I metadati (`noindex`) li dà la pagina.
 */
export const viewport: Viewport = PUBLIC_VIEWPORT;

export default function SurveyLayout({ children }: { children: React.ReactNode }) {
  return <PublicRoot>{children}</PublicRoot>;
}
