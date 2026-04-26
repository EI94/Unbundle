import type { Metadata } from "next";
import {
  breadcrumbJsonLd,
  jsonLdScriptProps,
} from "@/lib/seo/structured-data";

export const metadata: Metadata = {
  title: "Termini di servizio",
  description:
    "Termini di servizio di Unbundle: uso del servizio, integrazione Slack, limitazione di responsabilità.",
  alternates: { canonical: "/legal/terms" },
  openGraph: {
    title: "Termini di servizio — Unbundle",
    description:
      "Termini di servizio di Unbundle e dell'integrazione Slack.",
    url: "/legal/terms",
  },
};

export default function TermsPage() {
  return (
    <article className="space-y-4 text-sm leading-relaxed text-foreground">
      <script
        {...jsonLdScriptProps(
          breadcrumbJsonLd([
            { name: "Home", url: "/" },
            { name: "Termini di servizio", url: "/legal/terms" },
          ])
        )}
      />
      <h1 className="text-2xl font-semibold tracking-tight">Termini di servizio</h1>
      <p className="text-muted-foreground">
        Ultimo aggiornamento: aprile 2026. Bozza di riferimento; sostituiscila con
        i termini legali approvati dal titolare.
      </p>

      <h2 className="text-lg font-medium pt-6">Uso del servizio</h2>
      <p>
        L’uso di Unbundle è riservato a utenti autorizzati dal cliente. È
        vietato l’uso illecito, la violazione di sicurezza o il sovraccarico
        doloso delle infrastrutture.
      </p>

      <h2 className="text-lg font-medium pt-6">Integrazione Slack</h2>
      <p>
        Installando l’app Slack Unbundle, l’amministratore del workspace Slack
        autorizza le scope richieste e l’accesso ai canali e messaggi necessari
        alle funzionalità dichiarate dall’app.
      </p>

      <h2 className="text-lg font-medium pt-6">Limitazione di responsabilità</h2>
      <p>
        Il servizio è fornito secondo quanto contrattualmente pattuito con il
        cliente. Le disposizioni legali inderogabili restano ferme.
      </p>
    </article>
  );
}
