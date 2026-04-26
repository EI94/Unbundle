import type { Metadata } from "next";
import {
  breadcrumbJsonLd,
  jsonLdScriptProps,
} from "@/lib/seo/structured-data";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "Informativa sulla privacy di Unbundle: dati trattati, integrazione Slack, base giuridica, conservazione e diritti degli interessati.",
  alternates: { canonical: "/legal/privacy" },
  openGraph: {
    title: "Privacy Policy — Unbundle",
    description:
      "Informativa sulla privacy di Unbundle e dell'integrazione Slack.",
    url: "/legal/privacy",
  },
};

export default function PrivacyPage() {
  return (
    <article className="space-y-4 text-sm leading-relaxed text-foreground">
      <script
        {...jsonLdScriptProps(
          breadcrumbJsonLd([
            { name: "Home", url: "/" },
            { name: "Privacy Policy", url: "/legal/privacy" },
          ])
        )}
      />
      <h1 className="text-2xl font-semibold tracking-tight">Privacy Policy</h1>
      <p className="text-muted-foreground">
        Ultimo aggiornamento: aprile 2026. Documento di base per conformità
        all’installazione dell’app Slack Unbundle; integralo con i contenuti
        legali definitivi del tuo organismo.
      </p>

      <h2 className="text-lg font-medium pt-6">Titolare e contatti</h2>
      <p>
        Per esercizio dei diritti e domande privacy scrivi a{" "}
        <a
          href="mailto:privacy@theunbundle.com"
          className="text-primary underline underline-offset-2"
        >
          privacy@theunbundle.com
        </a>{" "}
        (sostituisci con l’indirizzo effettivo del titolare del trattamento).
      </p>

      <h2 className="text-lg font-medium pt-6">Dati trattati (prodotto Unbundle)</h2>
      <p>
        Unbundle tratta dati inseriti dagli utenti autorizzati (testi, use case,
        mapping attività, documenti caricati) e metadati tecnici necessari al
        funzionamento del servizio (account, log di sicurezza, identificativi
        workspace).
      </p>

      <h2 className="text-lg font-medium pt-6">Integrazione Slack</h2>
      <p>
        Se il workspace collega Slack, trattiamo identificativi Slack (team,
        utente, canale, contenuti dei messaggi inviati al bot) per erogare la
        raccolta contributi e le notifiche configurate. I token OAuth del bot
        sono conservati in modo sicuro sul backend e usati solo per le
        funzionalità dell’integrazione.
      </p>

      <h2 className="text-lg font-medium pt-6">Base giuridica e conservazione</h2>
      <p>
        Esecuzione del contratto / misure precontrattuali; legittimo interesse
        per sicurezza e miglioramento del servizio ove applicabile. I tempi di
        conservazione seguono la policy del titolare e i vincoli contrattuali
        con il cliente.
      </p>

      <h2 className="text-lg font-medium pt-6">Diritti degli interessati</h2>
      <p>
        Richiesta di accesso, rettifica, cancellazione, limitazione,
        portabilità, opposizione — secondo il GDPR e la normativa applicabile,
        contattando il titolare all’indirizzo indicato sopra.
      </p>
    </article>
  );
}
