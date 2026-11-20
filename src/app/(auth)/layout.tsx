import type { Viewport } from "next";
import { PublicRoot } from "@/components/public/public-shell";
import { PUBLIC_VIEWPORT } from "@/lib/public/page";

/**
 * (Rilascio 10, ondata 4, PROPOSTA-10 §3.11) L'accesso (`/login`) è una pagina fuori dalla dashboard: chiara, resa dal
 * server (`.survey-light`), con il guscio unico delle pagine pubbliche. Dentro nessun componente con portale (niente
 * toast: il link per la password mandato si dice nella pagina).
 */
export const viewport: Viewport = PUBLIC_VIEWPORT;

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <PublicRoot>{children}</PublicRoot>;
}
