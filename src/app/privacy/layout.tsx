import type { Viewport } from "next";
import { PublicRoot } from "@/components/public/public-shell";
import { PUBLIC_VIEWPORT } from "@/lib/public/page";

/**
 * (Rilascio 10, ondata 4, PROPOSTA-10 §3.11) L'informativa del questionario (`/privacy/ai-readiness/<token>`) è una pagina
 * fuori dalla dashboard: chiara, resa dal server (`.survey-light`; prima mancava, ed era sempre scura). Dentro nessun
 * componente con portale. I metadati (`noindex`) li dà la pagina.
 */
export const viewport: Viewport = PUBLIC_VIEWPORT;

export default function PrivacyLayout({ children }: { children: React.ReactNode }) {
  return <PublicRoot>{children}</PublicRoot>;
}
