import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default async function HomePage() {
  const session = await auth();
  if (session) redirect("/dashboard");

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-border">
        <div className="container mx-auto flex items-center justify-between px-4 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-sm">
              U
            </div>
            <span className="text-lg font-bold">Unbundle</span>
          </div>
          <Link href="/login">
            <Button variant="outline">Accedi</Button>
          </Link>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-4">
        <div className="max-w-2xl text-center">
          <h1 className="text-5xl font-bold tracking-tight sm:text-6xl">
            Scomponi il lavoro.
            <br />
            <span className="text-primary">Leggi il valore.</span>
          </h1>
          <p className="mt-6 text-lg text-muted-foreground leading-relaxed">
            Unbundle trasforma attivita&apos; disperse, workflow opachi e intuizioni
            locali in una mappa del valore, un portafoglio di use case e un piano
            di transizione verso l&apos;AI Native organization.
          </p>
          <div className="mt-10 flex items-center justify-center gap-4">
            <Link href="/login">
              <Button size="lg" className="text-base px-8">
                Inizia ora
              </Button>
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
