import type { Viewport } from "next";
import { PublicLink, PublicRoot, PublicShell } from "@/components/public/public-shell";
import { PUBLIC_VIEWPORT } from "@/lib/public/page";
import { PUBLIC_TEXT } from "@/lib/public/text";

/**
 * Le pagine legali (`/legal/privacy`, `/legal/terms`, `/legal/support`). (Rilascio 10, ondata 4, PROPOSTA-10 §3.11) Il
 * contenuto non cambia; il guscio è quello unico delle pagine pubbliche: chiaro, il marchio in alto non cliccabile, e in
 * fondo il piè di pagina pubblico con la home e le tre pagine, a 44 px.
 */
export const viewport: Viewport = PUBLIC_VIEWPORT;

const L = PUBLIC_TEXT.legal;

export default function LegalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <PublicRoot>
      <PublicShell
        footer={
          <nav aria-label={L.label} className="flex flex-wrap gap-x-5">
            <PublicLink href="/">{L.home}</PublicLink>
            <PublicLink href="/legal/privacy">{L.privacy}</PublicLink>
            <PublicLink href="/legal/terms">{L.terms}</PublicLink>
            <PublicLink href="/legal/support">{L.support}</PublicLink>
          </nav>
        }
      >
        <div className="mt-8">{children}</div>
      </PublicShell>
    </PublicRoot>
  );
}
