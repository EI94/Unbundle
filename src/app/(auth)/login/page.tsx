import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/login-form";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Accedi",
  description: "Accedi a Unbundle per gestire la tua AI Transformation.",
  robots: { index: false, follow: false, nocache: true },
  alternates: { canonical: "/login" },
};

export default async function LoginPage() {
  const session = await auth();
  if (session) redirect("/dashboard");

  return (
    <div className="min-h-screen flex">
      {/* Left — branding */}
      <div className="hidden lg:flex lg:flex-1 items-center justify-center px-12">
        <div className="max-w-md">
          <span className="text-sm font-medium tracking-wide">Unbundle</span>
          <h1 className="mt-8 text-3xl font-medium leading-snug tracking-tight">
            L&apos;AI non aumenta la produttivit&agrave;.
            <br />
            <span className="text-muted-foreground">
              Trasforma il modo di generare valore.
            </span>
          </h1>
          <p className="mt-6 text-sm text-muted-foreground leading-relaxed">
            Scomponi il lavoro. Mappa dove si concentra il valore. Scopri dove
            l&apos;AI cambia le regole del gioco.
          </p>
        </div>
      </div>

      {/* Right — form */}
      <div className="flex-1 flex items-center justify-center px-6 lg:px-12 lg:border-l lg:border-border">
        <div className="w-full max-w-sm">
          <div className="lg:hidden mb-10">
            <span className="text-sm font-medium tracking-wide">Unbundle</span>
          </div>

          <h2 className="text-lg font-medium mb-1">Accedi</h2>
          <p className="text-sm text-muted-foreground mb-8">
            Usa Google o email per continuare
          </p>

          <LoginForm />

          <p className="mt-10 text-xs text-muted-foreground">
            Accedendo accetti i{" "}
            <a href="/legal/terms" className="underline hover:text-foreground">
              Termini di Servizio
            </a>{" "}
            e la{" "}
            <a href="/legal/privacy" className="underline hover:text-foreground">
              Privacy Policy
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
