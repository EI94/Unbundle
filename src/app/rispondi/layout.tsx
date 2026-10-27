import type { Metadata, Viewport } from "next";

/**
 * Guscio dei link di «Chiedi al referente» (`/rispondi/[token]`, SPEC §4.1): pubblico, senza account,
 * mai indicizzato. Gli stessi metadati di `src/app/r/layout.tsx` (sostituiscono quelli della radice);
 * `next.config.ts` aggiunge `X-Robots-Tag`, `Cache-Control: no-store`, `Referrer-Policy: no-referrer`
 * e la CSP. Variante chiara (`.survey-light`) resa dal server, così anche le schede di servizio e
 * l'errore sono chiari. Dentro: nessun componente con portale (Select, Dialog, Popover, Tooltip, toast).
 * Non legge mai la sessione: la pagina è la stessa per chiunque abbia il link.
 */
export const metadata: Metadata = {
  title: { absolute: "Unbundle" },
  description: "Una richiesta di informazioni",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  alternates: { canonical: null },
  openGraph: { title: "Unbundle", description: "Una richiesta di informazioni" },
  twitter: { card: "summary", title: "Unbundle", description: "Una richiesta di informazioni" },
  referrer: "no-referrer",
};

export const viewport: Viewport = {
  themeColor: "#f9fafb",
  colorScheme: "light",
};

export default function ReferentAskLayout({ children }: { children: React.ReactNode }) {
  return (
    <div id="survey-root" className="survey-light min-h-dvh w-full min-w-0 overflow-x-hidden bg-background text-foreground">
      {children}
    </div>
  );
}
