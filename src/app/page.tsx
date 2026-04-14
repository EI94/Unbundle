import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

export default async function HomePage() {
  const session = await auth();
  if (session) redirect("/dashboard");

  return (
    <div className="min-h-screen flex flex-col">
      {/* Nav */}
      <header className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-8 py-5">
        <span className="text-sm font-medium tracking-wide">Unbundle</span>
        <Link
          href="/login"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Accedi
        </Link>
      </header>

      {/* Hero */}
      <main className="flex-1 flex items-center justify-center px-8">
        <div className="max-w-2xl">
          <p className="text-muted-foreground text-sm mb-6 tracking-wide">
            L&apos;AI sta cambiando le condizioni in cui opera la tua organizzazione.
          </p>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-medium leading-[1.1] tracking-tight">
            Capiremo dove si sposta
            <br />
            il valore e{" "}
            <span className="text-muted-foreground">cosa significa</span>
            <br />
            <span className="text-muted-foreground">per te.</span>
          </h1>
          <p className="mt-8 text-muted-foreground leading-relaxed max-w-lg">
            Unbundle scompone il lavoro della tua organizzazione, identifica dove
            l&apos;AI trasforma il modo di generare valore, e costruisce il piano per
            arrivarci.
          </p>
          <div className="mt-12">
            <Link
              href="/login"
              className="group inline-flex items-center gap-3 text-sm font-medium hover:gap-4 transition-all"
            >
              Inizia
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="px-8 py-6 flex items-center justify-between text-xs text-muted-foreground">
        <span>&copy; {new Date().getFullYear()} Unbundle</span>
        <span>AI-Powered Work Redesign</span>
      </footer>
    </div>
  );
}
