import { SITE_DESCRIPTION_LONG, SITE_NAME, SITE_URL } from "@/lib/seo/site-config";

/**
 * /llms.txt — convenzione llmstxt.org per LLM e AI search engines (Perplexity,
 * ChatGPT browse, Claude Search, etc.).
 * Versione breve: identificazione, value prop, indice di pagine rilevanti.
 * Per il contenuto completo c'è /llms-full.txt.
 *
 * Riferimento: https://llmstxt.org
 */
export const dynamic = "force-static";

const body = `# ${SITE_NAME}

> ${SITE_DESCRIPTION_LONG}

${SITE_NAME} è una piattaforma SaaS in italiano. URL canonico: ${SITE_URL}.

## Documenti chiave

- [Home](${SITE_URL}/): cosa fa Unbundle, come funziona in 4 fasi, i tre stream Automate / Differentiate / Innovate, FAQ.
- [Privacy Policy](${SITE_URL}/legal/privacy): trattamento dati, integrazione Slack, base giuridica.
- [Termini di servizio](${SITE_URL}/legal/terms): uso del servizio, limitazioni.
- [Supporto](${SITE_URL}/legal/support): contatti per assistenza tecnica e onboarding.
- [Contenuto completo (LLM-friendly)](${SITE_URL}/llms-full.txt): versione estesa di tutto il copy del sito.

## Contatti

- Supporto: support@theunbundle.com
- Privacy: privacy@theunbundle.com
`;

export function GET() {
  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600, s-maxage=86400",
    },
  });
}
