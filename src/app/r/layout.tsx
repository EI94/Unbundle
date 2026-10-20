import type { Metadata, Viewport } from "next";

/**
 * Guscio dei link personali dei referenti dei Casi d'uso (`/r/[token]`, PIANO
 * §5.4, §5.6). Pubblico, senza account e mai indicizzato: questi metadati
 * sostituiscono quelli della radice (unione superficiale), e `next.config.ts`
 * aggiunge `X-Robots-Tag`, `Cache-Control: no-store` e `Referrer-Policy:
 * no-referrer`. Variante chiara (`.survey-light`) resa dal server, così anche
 * la scheda «link non valido» e l'errore sono chiari. Dentro: nessun
 * componente con portale (Select, Dialog, Popover, Sheet, Tooltip, toast),
 * perché uscirebbe dal contenitore chiaro.
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

export default function ReferentLinkLayout({ children }: { children: React.ReactNode }) {
  return (
    <div id="survey-root" className="survey-light min-h-dvh w-full min-w-0 bg-background text-foreground">
      {children}
    </div>
  );
}
