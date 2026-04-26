import {
  DIFFERENTIATORS,
  FAQS,
  HOMEPAGE_DESCRIPTION,
  HOMEPAGE_TITLE,
  HOME_HERO,
  JOURNEY_STEPS,
  PERSONAS,
  STREAMS,
} from "@/lib/seo/copy";
import {
  SITE_CONTACTS,
  SITE_DESCRIPTION_LONG,
  SITE_NAME,
  SITE_URL,
} from "@/lib/seo/site-config";

/**
 * /llms-full.txt — versione "deep" pensata per essere ingerita interamente
 * da LLM e AI search. Tutto il copy della home in un unico documento Markdown.
 * Si rigenera dalle stesse fonti dei tag visibili → niente drift.
 */
export const dynamic = "force-static";

function build(): string {
  const lines: string[] = [];

  lines.push(`# ${SITE_NAME}`);
  lines.push("");
  lines.push(`> ${HOMEPAGE_DESCRIPTION}`);
  lines.push("");
  lines.push(`URL canonico: ${SITE_URL}`);
  lines.push("Lingua: italiano");
  lines.push(`Categoria: AI Transformation Platform / Business Software`);
  lines.push("");

  lines.push("## In una frase");
  lines.push("");
  lines.push(SITE_DESCRIPTION_LONG);
  lines.push("");

  lines.push(`## Hero`);
  lines.push("");
  lines.push(`Eyebrow: ${HOME_HERO.eyebrow}`);
  lines.push("");
  lines.push(
    `${HOME_HERO.h1Top} ${HOME_HERO.h1Mid}${HOME_HERO.h1MidEnd} ${HOME_HERO.h1End}`
  );
  lines.push("");
  lines.push(HOME_HERO.lead);
  lines.push("");

  lines.push("## Come funziona — 4 fasi");
  lines.push("");
  for (const step of JOURNEY_STEPS) {
    lines.push(`### ${step.n} — ${step.title}`);
    lines.push("");
    lines.push(step.body);
    lines.push("");
  }

  lines.push("## Framework: Automate / Differentiate / Innovate");
  lines.push("");
  lines.push(
    "Ogni attività della tua azienda finisce in uno di tre stream. Non serve scegliere fra automatizzare tutto o aspettare e vedere: servono tre risposte diverse, una per tipo di attività, con governance e KPI separati."
  );
  lines.push("");
  for (const s of STREAMS) {
    lines.push(`### ${s.title}`);
    lines.push("");
    lines.push(s.summary);
    lines.push("");
    for (const b of s.bullets) {
      lines.push(`- ${b}`);
    }
    lines.push("");
  }

  lines.push("## Per chi");
  lines.push("");
  for (const p of PERSONAS) {
    lines.push(`### ${p.title}`);
    lines.push("");
    lines.push(p.body);
    lines.push("");
  }

  lines.push("## Differenziatori");
  lines.push("");
  for (const d of DIFFERENTIATORS) {
    lines.push(`### ${d.title}`);
    lines.push("");
    lines.push(d.body);
    lines.push("");
  }

  lines.push("## FAQ");
  lines.push("");
  for (const f of FAQS) {
    lines.push(`### ${f.q}`);
    lines.push("");
    lines.push(f.a);
    lines.push("");
  }

  lines.push("## Architettura tecnica (per crawler tecnici)");
  lines.push("");
  lines.push(
    "- Stack: Next.js 16 App Router, React 19, TypeScript, Tailwind 4, shadcn/ui."
  );
  lines.push(
    "- Database: Postgres (Neon o self-hosted) con Drizzle ORM. RAG via tsvector full-text search in italiano."
  );
  lines.push(
    "- AI: Anthropic SDK con Claude Sonnet (default). Web search nativa Anthropic. Generatori usano generateObject con schemi Zod."
  );
  lines.push(
    "- Auth: Firebase Auth con session cookie, ruoli: exec_sponsor, transformation_lead, function_lead, contributor, analyst."
  );
  lines.push(
    "- Slack: chat-adapter/slack su state-pg (Postgres). OAuth v2, signing-secret HMAC verification, Block Kit, Slack Connect-safe."
  );
  lines.push(
    "- Multi-tenant: organizations → memberships → workspaces. KPI di scoring custom per workspace."
  );
  lines.push("- Hosting: Vercel.");
  lines.push("");

  lines.push("## Contatti");
  lines.push("");
  lines.push(`- Supporto: ${SITE_CONTACTS.support}`);
  lines.push(`- Privacy: ${SITE_CONTACTS.privacy}`);
  lines.push("");

  lines.push("## Pagine pubbliche");
  lines.push("");
  lines.push(`- Home: ${SITE_URL}/`);
  lines.push(`- Privacy Policy: ${SITE_URL}/legal/privacy`);
  lines.push(`- Termini di servizio: ${SITE_URL}/legal/terms`);
  lines.push(`- Supporto: ${SITE_URL}/legal/support`);
  lines.push("");

  lines.push(`---`);
  lines.push("");
  lines.push(`Titolo principale: ${HOMEPAGE_TITLE}`);
  lines.push(
    "Questo file segue la convenzione llmstxt.org per facilitare l'ingest da parte di LLM e AI search engines."
  );

  return lines.join("\n");
}

export function GET() {
  return new Response(build(), {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600, s-maxage=86400",
    },
  });
}
