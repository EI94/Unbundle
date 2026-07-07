import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/login-form";
import { safeInternalCallbackUrl } from "@/lib/navigation/safe-callback-url";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Accedi",
  description: "Accedi a Unbundle per gestire la tua AI Transformation.",
  robots: { index: false, follow: false, nocache: true },
  alternates: { canonical: "/login" },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<{ callbackUrl?: string; session?: string }>;
}) {
  const session = await auth();
  const sp = searchParams ? await searchParams : {};
  const callbackUrl = safeInternalCallbackUrl(sp.callbackUrl);
  if (session) redirect(callbackUrl ?? "/dashboard");
  const sessionExpired = sp.session === "stale";

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

          {sessionExpired && (
            <div
              className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm"
              role="status"
              data-testid="session-stale-banner"
            >
              La tua sessione è scaduta o è stata revocata. Accedi di nuovo per
              continuare.
            </div>
          )}

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
