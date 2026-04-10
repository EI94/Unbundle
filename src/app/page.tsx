import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Compass,
  GitBranch,
  Lightbulb,
  BarChart3,
  Zap,
  Shield,
  ArrowRight,
  ChevronRight,
  Layers,
  Brain,
  Target,
  Sparkles,
} from "lucide-react";

export default async function HomePage() {
  const session = await auth();
  if (session) redirect("/dashboard");

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Nav */}
      <header className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-lg">
        <div className="container mx-auto flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground font-bold text-sm">
              U
            </div>
            <span className="text-xl font-bold tracking-tight">Unbundle</span>
          </div>
          <Link href="/login">
            <Button variant="outline" className="gap-2">
              Accedi <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-primary/5 via-transparent to-transparent" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/10 via-transparent to-transparent" />
        <div className="container relative mx-auto px-6 pt-24 pb-20 lg:pt-32 lg:pb-28">
          <div className="mx-auto max-w-4xl text-center">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-4 py-1.5 text-sm font-medium text-primary">
              <Sparkles className="h-4 w-4" />
              Piattaforma AI per la trasformazione organizzativa
            </div>
            <h1 className="text-5xl font-bold tracking-tight sm:text-7xl lg:text-8xl">
              Scomponi il lavoro.
              <br />
              <span className="bg-gradient-to-r from-primary via-primary/80 to-primary/60 bg-clip-text text-transparent">
                Leggi il valore.
              </span>
            </h1>
            <p className="mx-auto mt-8 max-w-2xl text-lg text-muted-foreground leading-relaxed sm:text-xl">
              Unbundle guida la tua organizzazione da attivit&agrave; disperse e
              workflow opachi a una mappa del valore chiara, un portafoglio di use
              case AI e un piano di transizione verso l&apos;AI Native organization.
            </p>
            <div className="mt-12 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
              <Link href="/login">
                <Button size="lg" className="h-14 gap-2 px-8 text-base font-semibold">
                  Inizia la trasformazione
                  <ArrowRight className="h-5 w-5" />
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="border-t border-border/50 bg-muted/30">
        <div className="container mx-auto px-6 py-24 lg:py-32">
          <div className="mx-auto max-w-2xl text-center mb-16">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Come funziona Unbundle
            </h2>
            <p className="mt-4 text-muted-foreground text-lg">
              4 agenti AI specializzati ti guidano dall&apos;analisi alla
              trasformazione, passo dopo passo.
            </p>
          </div>

          <div className="mx-auto max-w-5xl">
            <div className="grid gap-0 md:grid-cols-4">
              {[
                {
                  step: "01",
                  icon: Compass,
                  title: "Intervista Strategica",
                  description:
                    "Un agente AI intervista la leadership per capire dove si crea valore, quali processi sono critici e dove l'AI pu\u00f2 fare la differenza.",
                  color: "text-blue-600 bg-blue-100 dark:bg-blue-900/50 dark:text-blue-400",
                },
                {
                  step: "02",
                  icon: GitBranch,
                  title: "Activity Mapping",
                  description:
                    "Per ogni dipartimento, un agente AI scompone le attivit\u00e0 in unit\u00e0 analizzabili: input, output, strumenti, decision points, pain points.",
                  color: "text-violet-600 bg-violet-100 dark:bg-violet-900/50 dark:text-violet-400",
                },
                {
                  step: "03",
                  icon: Lightbulb,
                  title: "Classificazione & Use Cases",
                  description:
                    "L'AI classifica ogni attivit\u00e0 (automatable, augmentable, differentiating) e genera use case con scoring impatto/fattibilit\u00e0.",
                  color: "text-amber-600 bg-amber-100 dark:bg-amber-900/50 dark:text-amber-400",
                },
                {
                  step: "04",
                  icon: BarChart3,
                  title: "Piano & Simulazione",
                  description:
                    "Un piano di trasformazione sequenziato (Quick Wins \u2192 Capability Builders \u2192 Strategic Bets) con simulazione FTE e scenari di impatto.",
                  color: "text-emerald-600 bg-emerald-100 dark:bg-emerald-900/50 dark:text-emerald-400",
                },
              ].map((item, i) => (
                <div key={item.step} className="relative flex flex-col items-center text-center p-6">
                  {i < 3 && (
                    <div className="hidden md:block absolute top-14 left-1/2 w-full h-px bg-border" />
                  )}
                  <div className={`relative z-10 flex h-14 w-14 items-center justify-center rounded-2xl ${item.color} mb-5`}>
                    <item.icon className="h-7 w-7" />
                  </div>
                  <span className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-2">
                    Step {item.step}
                  </span>
                  <h3 className="text-lg font-semibold mb-2">{item.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {item.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Capabilities */}
      <section className="border-t border-border/50">
        <div className="container mx-auto px-6 py-24 lg:py-32">
          <div className="mx-auto max-w-2xl text-center mb-16">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Cosa scopri con Unbundle
            </h2>
            <p className="mt-4 text-muted-foreground text-lg">
              Una radiografia completa del lavoro nella tua organizzazione,
              con raccomandazioni azionabili.
            </p>
          </div>
          <div className="mx-auto grid max-w-5xl gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                icon: Layers,
                title: "Value Map",
                description:
                  "Visualizza dove si concentra il valore nella tua organizzazione con una Wardley Map interattiva.",
              },
              {
                icon: Brain,
                title: "AI Classification",
                description:
                  "Ogni attivit\u00e0 viene classificata: automatable, augmentable, differentiating, emerging opportunity.",
              },
              {
                icon: Target,
                title: "Use Case Portfolio",
                description:
                  "Use case AI prioritizzati con scoring 1-5 su 10 dimensioni di impatto e fattibilit\u00e0.",
              },
              {
                icon: Zap,
                title: "Agent Blueprints",
                description:
                  "Per ogni use case, un progetto tecnico dell\u2019agente AI: architettura, input/output, guardrails.",
              },
              {
                icon: BarChart3,
                title: "Simulazione Scenari",
                description:
                  "3 scenari (conservativo, moderato, aggressivo) con impatto FTE, costi e timeline.",
              },
              {
                icon: Shield,
                title: "Intelligence Continua",
                description:
                  "Segnali settimanali su nuove opportunit\u00e0, benchmark di settore e rischi emergenti.",
              },
            ].map((cap) => (
              <div
                key={cap.title}
                className="group rounded-2xl border border-border/60 bg-card p-6 transition-all hover:border-primary/30 hover:shadow-lg"
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary mb-4 transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                  <cap.icon className="h-5 w-5" />
                </div>
                <h3 className="text-lg font-semibold mb-2">{cap.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {cap.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-border/50 bg-muted/30">
        <div className="container mx-auto px-6 py-24 lg:py-32">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Pronto a scomporre il lavoro e leggere il valore?
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              Inizia con un&apos;intervista strategica guidata dall&apos;AI.
              In 30 minuti avrai una prima mappa del valore della tua organizzazione.
            </p>
            <div className="mt-10">
              <Link href="/login">
                <Button size="lg" className="h-14 gap-2 px-10 text-base font-semibold">
                  Inizia gratuitamente
                  <ChevronRight className="h-5 w-5" />
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/50">
        <div className="container mx-auto flex items-center justify-between px-6 py-8">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-xs">
              U
            </div>
            <span className="text-sm font-semibold">Unbundle</span>
          </div>
          <p className="text-sm text-muted-foreground">
            &copy; {new Date().getFullYear()} Unbundle. Trasforma la tua organizzazione con l&apos;AI.
          </p>
        </div>
      </footer>
    </div>
  );
}
