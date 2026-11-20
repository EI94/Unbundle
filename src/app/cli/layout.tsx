import type { Viewport } from "next";
import { PublicRoot } from "@/components/public/public-shell";
import { PUBLIC_VIEWPORT } from "@/lib/public/page";

/**
 * (Rilascio 10, ondata 4, PROPOSTA-10 §3.11) «Collega la CLI» (`/cli/collega`) è una pagina fuori dalla dashboard: chiara,
 * resa dal server (`.survey-light`), con il guscio unico delle pagine pubbliche. Dentro nessun componente con portale.
 */
export const viewport: Viewport = PUBLIC_VIEWPORT;

export default function CliLayout({ children }: { children: React.ReactNode }) {
  return <PublicRoot>{children}</PublicRoot>;
}
