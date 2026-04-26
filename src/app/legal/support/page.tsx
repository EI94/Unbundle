import type { Metadata } from "next";
import {
  breadcrumbJsonLd,
  jsonLdScriptProps,
} from "@/lib/seo/structured-data";

export const metadata: Metadata = {
  title: "Supporto",
  description:
    "Contatti e supporto per Unbundle e per l'integrazione Slack: assistenza tecnica, onboarding, OAuth e gestione del workspace.",
  alternates: { canonical: "/legal/support" },
  openGraph: {
    title: "Supporto — Unbundle",
    description:
      "Contatti e supporto per Unbundle e l'integrazione Slack.",
    url: "/legal/support",
  },
};

export default function SupportPage() {
  return (
    <article className="space-y-4 text-sm leading-relaxed text-foreground">
      <script
        {...jsonLdScriptProps(
          breadcrumbJsonLd([
            { name: "Home", url: "/" },
            { name: "Supporto", url: "/legal/support" },
          ])
        )}
      />
      <h1 className="text-2xl font-semibold tracking-tight">Supporto</h1>
      <p className="text-muted-foreground">
        Pagina pubblica per l’app Slack Unbundle e per i clienti del prodotto
        web.
      </p>

      <h2 className="text-lg font-medium pt-6">Assistenza</h2>
      <p>
        Per problemi tecnici, onboarding o integrazione Slack:{" "}
        <a
          href="mailto:support@theunbundle.com"
          className="text-primary underline underline-offset-2"
        >
          support@theunbundle.com
        </a>
      </p>
      <p className="text-sm text-muted-foreground">
        Sostituisci l’indirizzo con quello reale del team commerciale / IT che
        gestisce Unbundle per i clienti.
      </p>

      <h2 className="text-lg font-medium pt-6">Installazione Slack per un’azienda</h2>
      <p>
        Ogni organizzazione che usa Unbundle collega il proprio workspace Slack
        dall’area <strong>Impostazioni</strong> del proprio progetto Unbundle
        (installazione OAuth). Non è necessario che tutti i clienti condividano
        lo stesso workspace Slack.
      </p>
    </article>
  );
}
