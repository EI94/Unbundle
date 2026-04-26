import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
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
  faqJsonLd,
  jsonLdScriptProps,
  softwareApplicationJsonLd,
} from "@/lib/seo/structured-data";
import { SITE_NAME } from "@/lib/seo/site-config";

export const metadata: Metadata = {
  title: HOMEPAGE_TITLE,
  description: HOMEPAGE_DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: {
    title: HOMEPAGE_TITLE,
    description: HOMEPAGE_DESCRIPTION,
    url: "/",
  },
  twitter: {
    title: HOMEPAGE_TITLE,
    description: HOMEPAGE_DESCRIPTION,
  },
};

export default async function HomePage() {
  const session = await auth();
  if (session) redirect("/dashboard");

  return (
    <div className="min-h-screen flex flex-col">
      {/* JSON-LD specifici della home: SoftwareApplication + FAQPage. */}
      <script
        {...jsonLdScriptProps([softwareApplicationJsonLd(), faqJsonLd(FAQS)])}
      />

      {/* Top banner + Nav */}
      <div className="fixed top-0 left-0 right-0 z-50">
        {/* Announcement banner — Monteporzio Living */}
        <a
          href="https://www.urbanova.life/monteporzioliving"
          target="_blank"
          rel="noopener noreferrer"
          className="group block bg-foreground text-background text-xs px-8 py-2.5 text-center hover:bg-foreground/90 transition-colors"
        >
          <span className="opacity-70 mr-2 uppercase tracking-[0.18em]">Nuovo progetto</span>
          <span className="font-medium">Monteporzio Living</span>
          <span className="opacity-70 mx-2">·</span>
          <span className="underline-offset-4 group-hover:underline">Scopri su Urbanova →</span>
        </a>
        <header className="flex items-center justify-between px-8 py-5 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b border-border">
          <Link href="/" className="text-sm font-medium tracking-wide" aria-label={`${SITE_NAME} — home`}>
            Unbundle
          </Link>
          <nav className="flex items-center gap-6 text-sm">
            <a
              href="#come-funziona"
              className="hidden sm:inline text-muted-foreground hover:text-foreground transition-colors"
            >
              Come funziona
            </a>
            <a
              href="#stream"
              className="hidden sm:inline text-muted-foreground hover:text-foreground transition-colors"
            >
              Framework
            </a>
            <a
              href="#urbanova"
              className="hidden md:inline text-muted-foreground hover:text-foreground transition-colors"
            >
              Urbanova
            </a>
            <a
              href="#faq"
              className="hidden sm:inline text-muted-foreground hover:text-foreground transition-colors"
            >
              FAQ
            </a>
            <Link
              href="/login"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              Accedi
            </Link>
          </nav>
        </header>
      </div>

      <main className="flex-1">
        {/* Hero */}
        <section className="min-h-screen flex items-center justify-center px-8">
          <div className="max-w-2xl">
            <p className="text-muted-foreground text-sm mb-6 tracking-wide">
              {HOME_HERO.eyebrow}
            </p>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-medium leading-[1.1] tracking-tight">
              {HOME_HERO.h1Top}
              <br />
              {HOME_HERO.h1Mid}{" "}
              <span className="text-muted-foreground">{HOME_HERO.h1MidEnd}</span>
              <br />
              <span className="text-muted-foreground">{HOME_HERO.h1End}</span>
            </h1>
            <p className="mt-8 text-muted-foreground leading-relaxed max-w-lg">
              {HOME_HERO.lead}
            </p>
            <div className="mt-12">
              <Link
                href="/login"
                className="group inline-flex items-center gap-3 text-sm font-medium hover:gap-4 transition-all"
              >
                {HOME_HERO.cta}
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
            </div>
          </div>
        </section>

        {/* Come funziona — i 4 step del journey */}
        <section
          id="come-funziona"
          className="border-t border-border px-8 py-24 sm:py-32"
        >
          <div className="mx-auto max-w-5xl">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-4">
              Come funziona
            </p>
            <h2 className="text-3xl sm:text-4xl font-medium tracking-tight max-w-2xl">
              Da una conversazione con la leadership alla roadmap di
              trasformazione, in quattro fasi.
            </h2>
            <ol className="mt-16 grid gap-10 sm:grid-cols-2">
              {JOURNEY_STEPS.map((step) => (
                <li key={step.n} className="flex gap-6">
                  <span className="text-xs font-mono text-muted-foreground pt-1 tabular-nums">
                    {step.n}
                  </span>
                  <div>
                    <h3 className="text-base font-medium">{step.title}</h3>
                    <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                      {step.body}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Tre stream — Automate, Differentiate, Innovate */}
        <section id="stream" className="border-t border-border px-8 py-24 sm:py-32">
          <div className="mx-auto max-w-5xl">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-4">
              Il framework
            </p>
            <h2 className="text-3xl sm:text-4xl font-medium tracking-tight max-w-2xl">
              Ogni attività della tua azienda finisce in uno di tre stream.
            </h2>
            <p className="mt-6 text-muted-foreground max-w-2xl leading-relaxed">
              Non serve scegliere fra <em>automatizzare tutto</em> o{" "}
              <em>aspettare e vedere</em>. Servono tre risposte diverse, una
              per tipo di attività — con governance e KPI separati.
            </p>
            <div className="mt-16 grid gap-12 lg:grid-cols-3">
              {STREAMS.map((s) => (
                <article key={s.key}>
                  <h3 className="text-2xl font-medium tracking-tight">
                    {s.title}
                  </h3>
                  <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
                    {s.summary}
                  </p>
                  <ul className="mt-6 space-y-2 text-sm text-muted-foreground">
                    {s.bullets.map((b) => (
                      <li key={b} className="flex gap-2">
                        <span aria-hidden>—</span>
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* Per chi */}
        <section className="border-t border-border px-8 py-24 sm:py-32">
          <div className="mx-auto max-w-5xl">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-4">
              Per chi
            </p>
            <h2 className="text-3xl sm:text-4xl font-medium tracking-tight max-w-2xl">
              Pensato per chi guida la trasformazione, non per chi la subisce.
            </h2>
            <div className="mt-16 grid gap-10 sm:grid-cols-3">
              {PERSONAS.map((p) => (
                <div key={p.title}>
                  <h3 className="text-base font-medium">{p.title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                    {p.body}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Differenziatori */}
        <section className="border-t border-border px-8 py-24 sm:py-32">
          <div className="mx-auto max-w-5xl">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-4">
              Differenze
            </p>
            <h2 className="text-3xl sm:text-4xl font-medium tracking-tight max-w-2xl">
              Niente template Excel. Niente vendor lock-in.
            </h2>
            <div className="mt-16 grid gap-10 sm:grid-cols-2">
              {DIFFERENTIATORS.map((d) => (
                <div key={d.title}>
                  <h3 className="text-base font-medium">{d.title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                    {d.body}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="border-t border-border px-8 py-24 sm:py-32">
          <div className="mx-auto max-w-3xl">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-4">
              FAQ
            </p>
            <h2 className="text-3xl sm:text-4xl font-medium tracking-tight">
              Le domande che ci fanno più spesso.
            </h2>
            <dl className="mt-12 space-y-10">
              {FAQS.map((f) => (
                <div key={f.q} className="border-t border-border pt-6">
                  <dt className="text-base font-medium">{f.q}</dt>
                  <dd className="mt-3 text-sm text-muted-foreground leading-relaxed">
                    {f.a}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* Urbanova — sezione compatta. Mostra che sappiamo cosa facciamo,
            senza rubare la scena al prodotto Unbundle. */}
        <section
          id="urbanova"
          className="border-t border-border px-8 py-20 sm:py-24"
        >
          <div className="mx-auto max-w-5xl">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-4">
              Da chi costruisce, per chi costruisce
            </p>
            <div className="grid gap-10 lg:grid-cols-[1.2fr_1fr] lg:gap-16 items-start">
              <div>
                <h2 className="text-2xl sm:text-3xl font-medium tracking-tight">
                  Costruiamo software dove serve risolvere problemi veri.
                </h2>
                <p className="mt-5 text-sm text-muted-foreground leading-relaxed max-w-xl">
                  Oltre a Unbundle, sviluppiamo{" "}
                  <a
                    href="https://www.weareurbanova.com/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-foreground underline underline-offset-4 hover:no-underline"
                  >
                    Urbanova
                  </a>
                  : l&apos;assistente operativo per lo sviluppo immobiliare.
                  Business Plan in 5 minuti, scenari (cash, permuta, pagamento
                  differito), leve di negoziazione, cantiere e clienti — un
                  solo flusso, numeri difendibili.
                </p>
                <div className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-3 text-sm">
                  <a
                    href="https://www.weareurbanova.com/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group inline-flex items-center gap-2 font-medium hover:gap-3 transition-all"
                  >
                    Scopri Urbanova
                    <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                  </a>
                  <a
                    href="https://www.urbanova.life/auth/login"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Accedi alla piattaforma →
                  </a>
                </div>
              </div>

              <div className="lg:pl-8 lg:border-l lg:border-border">
                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground mb-4">
                  Progetti in evidenza
                </p>
                <ul className="space-y-3 text-sm">
                  <li>
                    <a
                      href="https://www.urbanova.life/monteporzioliving"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group flex items-baseline justify-between gap-4 py-2 border-b border-border hover:border-foreground transition-colors"
                    >
                      <span className="font-medium">Monteporzio Living</span>
                      <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors">
                        Nuovo →
                      </span>
                    </a>
                  </li>
                </ul>
                <p className="mt-6 text-xs text-muted-foreground leading-relaxed">
                  Ogni progetto vive su un proprio sotto-dominio Urbanova,
                  pronto da condividere con soci, partner e acquirenti.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* CTA finale */}
        <section className="border-t border-border px-8 py-24 sm:py-32">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="text-3xl sm:text-4xl font-medium tracking-tight">
              Iniziamo dalla Discovery.
            </h2>
            <p className="mt-6 text-muted-foreground leading-relaxed">
              In 30 minuti hai una prima mappa di dove l&apos;AI sposta il
              valore nella tua organizzazione.
            </p>
            <div className="mt-10">
              <Link
                href="/login"
                className="group inline-flex items-center gap-3 text-sm font-medium hover:gap-4 transition-all"
              >
                Accedi
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-border px-8 py-10 text-xs text-muted-foreground">
        <div className="mx-auto max-w-5xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <span>&copy; {new Date().getFullYear()} {SITE_NAME}</span>
            <span>AI-Powered Work Redesign</span>
          </div>
          <nav className="flex flex-wrap items-center gap-6">
            <Link
              href="/legal/privacy"
              className="hover:text-foreground transition-colors"
            >
              Privacy
            </Link>
            <Link
              href="/legal/terms"
              className="hover:text-foreground transition-colors"
            >
              Termini
            </Link>
            <Link
              href="/legal/support"
              className="hover:text-foreground transition-colors"
            >
              Supporto
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
