import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/login-form";
import { PublicFooterLine, PublicLink, PublicShell } from "@/components/public/public-shell";
import { safeInternalCallbackUrl } from "@/lib/navigation/safe-callback-url";
import { LOGIN_TEXT } from "@/lib/public/login";
import type { Metadata } from "next";

/**
 * L'accesso a Unbundle (`/login`, con `callbackUrl` e l'avviso della sessione scaduta `?session=stale`).
 *
 * (Rilascio 10, ondata 4, docs/ui-10/PROPOSTA-10.md §3.11, audit Fuori §3.1) Il guscio unico delle pagine pubbliche,
 * chiaro, una colonna: H1 «Accedi a Unbundle» anche al telefono (prima stava nel pannello di marketing, nascosto al
 * telefono), da un invito una riga «Poi torni all'invito.», la sessione scaduta in una riga, in fondo i termini e
 * «Privacy». I testi stanno in `src/lib/public/login.ts`.
 */
export const metadata: Metadata = {
  title: LOGIN_TEXT.metaTitle,
  description: LOGIN_TEXT.metaDescription,
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
  // Chi arriva da un invito sta finendo di entrare in un workspace: lo dice la
  // pagina, e il modulo parte da «crea account» se l'invito lo chiede.
  const fromInvite = callbackUrl?.startsWith("/invite/") ?? false;

  return (
    <PublicShell
      footer={
        <PublicFooterLine>
          {LOGIN_TEXT.terms} <PublicLink href="/legal/terms">{LOGIN_TEXT.termsLink}</PublicLink> {LOGIN_TEXT.and}{" "}
          <PublicLink href="/legal/privacy">{LOGIN_TEXT.privacyLink}</PublicLink>.
        </PublicFooterLine>
      }
    >
      <h1 className="mt-6 text-2xl font-semibold tracking-tight">{LOGIN_TEXT.title}</h1>
      {fromInvite ? <p className="mt-2 text-muted-foreground">{LOGIN_TEXT.fromInvite}</p> : null}
      {sessionExpired ? (
        <p className="mt-4 rounded-xl bg-uc-giallo-bg px-4 py-3" role="status" data-testid="session-stale-banner">
          {LOGIN_TEXT.stale}
        </p>
      ) : null}
      <div className="mt-6">
        <LoginForm />
      </div>
    </PublicShell>
  );
}
