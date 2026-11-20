"use client";

import { useState, useMemo, useSyncExternalStore, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { safeInternalCallbackUrl } from "@/lib/navigation/safe-callback-url";
import {
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  updateProfile,
} from "firebase/auth";
import { firebaseAuth } from "@/lib/firebase/client";
import {
  firebaseErrorCode,
  firebaseErrorMessage,
  GOOGLE_NEEDS_REAL_BROWSER,
  isInAppBrowser,
} from "@/lib/firebase/auth-errors";
import { LOGIN_TEXT } from "@/lib/public/login";
import { cn } from "@/lib/utils";
import { PUBLIC_FIELD, PUBLIC_LABEL, PUBLIC_LINK, PUBLIC_PRIMARY, PUBLIC_SECONDARY } from "@/components/public/classes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";

/**
 * Il modulo d'accesso di `/login`: Google, email e password, account nuovo, nuova password.
 *
 * (Rilascio 10, ondata 4, PROPOSTA-10 §3.11, audit Fuori §3.1) Nel guscio unico delle pagine pubbliche, chiaro: un solo
 * pulsante pieno (quello del modulo: «Accedi», «Crea account» o «Mandami il link per la password»), Google bordato; i
 * link secondari alti 44 px; etichette leggibili e campi a 16 px; il segnaposto della password solo per un account nuovo.
 * Il link per la password mandato si dice nella pagina, non con un toast (un portale uscirebbe dal contenitore chiaro).
 * I testi stanno in `src/lib/public/login.ts`.
 */

const L = LOGIN_TEXT.form;

type Mode = "login" | "register" | "reset";

/** Lo user agent non cambia mentre la pagina è aperta: niente a cui iscriversi. */
function noSubscribe(): () => void {
  return () => undefined;
}

function LoginFormInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const afterLogin = useMemo(
    () => safeInternalCallbackUrl(searchParams.get("callbackUrl")),
    [searchParams]
  );
  // Da un invito si arriva già in «crea account», con l'email dell'invito:
  // chi è nuovo non deve cercare il link «Registrati» dopo un errore.
  const [mode, setMode] = useState<Mode>(() =>
    searchParams.get("mode") === "register" ? "register" : "login"
  );
  const [email, setEmail] = useState(() => {
    const invited = searchParams.get("email")?.trim() ?? "";
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(invited) ? invited.slice(0, 254) : "";
  });
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [suggestRegister, setSuggestRegister] = useState(false);
  // Lo user agent non esiste durante il rendering sul server: lì, e all'idratazione, `false`;
  // subito dopo il valore del browser. Vale anche un browser che lo user agent non dice, quando la
  // finestra di Google non si apre.
  const inAppUserAgent = useSyncExternalStore(noSubscribe, () => isInAppBrowser(navigator.userAgent), () => false);
  const [googleBlocked, setGoogleBlocked] = useState(false);
  const inAppBrowser = inAppUserAgent || googleBlocked;
  const [linkCopied, setLinkCopied] = useState(false);

  async function copyPageLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setLinkCopied(true);
    } catch {
      setLinkCopied(false);
    }
  }

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setNotice(null);
    setSuggestRegister(false);
  }

  async function exchangeToken(idToken: string) {
    const res = await fetch("/api/auth/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? L.session);
    }
  }

  async function handleGoogle() {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const provider = new GoogleAuthProvider();
      // Sempre la scelta dell'account: chi ha cliccato «Cambia account» non
      // deve rientrare in automatico con quello di prima.
      provider.setCustomParameters({ prompt: "select_account" });
      const result = await signInWithPopup(firebaseAuth, provider);
      const idToken = await result.user.getIdToken();
      await exchangeToken(idToken);
      router.push(afterLogin ?? "/dashboard");
    } catch (err) {
      const code = firebaseErrorCode(err);
      if (GOOGLE_NEEDS_REAL_BROWSER.has(code)) {
        setGoogleBlocked(true);
        setError(L.googleBlocked);
      } else if (code) {
        setError(firebaseErrorMessage(err));
      } else {
        setError(err instanceof Error && err.message ? err.message : L.googleFailed);
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setNotice(null);
    setSuggestRegister(false);

    try {
      if (mode === "reset") {
        await sendPasswordResetEmail(firebaseAuth, email);
        switchMode("login");
        setNotice(L.resetSent);
        setLoading(false);
        return;
      }

      let cred;
      if (mode === "register") {
        cred = await createUserWithEmailAndPassword(
          firebaseAuth,
          email,
          password
        );
        if (name.trim()) {
          await updateProfile(cred.user, { displayName: name.trim() });
        }
      } else {
        cred = await signInWithEmailAndPassword(firebaseAuth, email, password);
      }

      const idToken = await cred.user.getIdToken();
      await exchangeToken(idToken);
      router.push(afterLogin ?? "/dashboard");
    } catch (err) {
      const code = firebaseErrorCode(err);
      if (mode === "login" && (code === "auth/invalid-credential" || code === "auth/user-not-found")) {
        setSuggestRegister(true);
        setError(L.wrong);
      } else if (code) {
        setError(firebaseErrorMessage(err));
      } else {
        setError(err instanceof Error && err.message ? err.message : L.failed);
      }
    } finally {
      setLoading(false);
    }
  }

  const secondary = cn(PUBLIC_LINK, "text-sm text-muted-foreground");

  return (
    <div className="space-y-5">
      {inAppBrowser && (
        <div className="rounded-xl bg-uc-giallo-bg p-4" role="status" data-testid="in-app-browser-hint">
          <p>{L.inApp}</p>
          <Button type="button" variant="outline" className="mt-3 h-11" onClick={copyPageLink}>
            {linkCopied ? L.copied : L.copy}
          </Button>
        </div>
      )}
      {notice && (
        <p className="rounded-xl bg-uc-verde-bg px-4 py-3" role="status" data-testid="login-notice">
          {notice}
        </p>
      )}
      {error && (
        <div className="rounded-xl bg-destructive/10 px-4 py-3 text-destructive" role="alert" data-testid="login-error">
          <p>{error}</p>
          {suggestRegister && (
            <button type="button" className={cn(PUBLIC_LINK, "text-destructive")} onClick={() => switchMode("register")}>
              {L.suggestRegister}
            </button>
          )}
        </div>
      )}
      <Button type="button" variant="outline" className={cn(PUBLIC_SECONDARY, "gap-2")} onClick={handleGoogle} disabled={loading} data-testid="login-google">
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden>
            <path
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
              fill="#4285F4"
            />
            <path
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              fill="#34A853"
            />
            <path
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              fill="#FBBC05"
            />
            <path
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              fill="#EA4335"
            />
          </svg>
        )}
        {L.google}
      </Button>

      <div className="flex items-center gap-4">
        <div className="h-px flex-1 bg-border" />
        <span className="text-sm text-muted-foreground">{L.or}</span>
        <div className="h-px flex-1 bg-border" />
      </div>

      <form onSubmit={handleEmailSubmit} className="space-y-4">
        {mode === "register" && (
          <div className="space-y-1.5">
            <Label htmlFor="name" className={PUBLIC_LABEL}>
              {L.name}
            </Label>
            <Input
              id="name"
              type="text"
              autoComplete="name"
              placeholder={L.namePlaceholder}
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={loading}
              className={PUBLIC_FIELD}
            />
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="email" className={PUBLIC_LABEL}>
            {L.email}
          </Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder={L.emailPlaceholder}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={loading}
            className={PUBLIC_FIELD}
          />
        </div>

        {mode !== "reset" && (
          <div className="space-y-1.5">
            <Label htmlFor="password" className={PUBLIC_LABEL}>
              {L.password}
            </Label>
            <Input
              id="password"
              type="password"
              autoComplete={mode === "register" ? "new-password" : "current-password"}
              placeholder={mode === "register" ? L.passwordPlaceholder : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              disabled={loading}
              className={PUBLIC_FIELD}
            />
          </div>
        )}

        <Button type="submit" disabled={loading} className={PUBLIC_PRIMARY} data-testid="login-submit">
          {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          {mode === "login" ? L.login : mode === "register" ? L.register : L.reset}
        </Button>
      </form>

      <div className="flex flex-col items-center">
        {mode === "login" && (
          <>
            <button type="button" className={secondary} onClick={() => switchMode("register")}>
              {L.toRegister}
            </button>
            <button type="button" className={secondary} onClick={() => switchMode("reset")}>
              {L.forgot}
            </button>
          </>
        )}
        {mode === "register" && (
          <button type="button" className={secondary} onClick={() => switchMode("login")}>
            {L.toLogin}
          </button>
        )}
        {mode === "reset" && (
          <button type="button" className={secondary} onClick={() => switchMode("login")}>
            {L.back}
          </button>
        )}
      </div>
    </div>
  );
}

export function LoginForm() {
  return (
    <Suspense fallback={<div className="flex h-40 items-center justify-center text-sm text-muted-foreground">{L.loading}</div>}>
      <LoginFormInner />
    </Suspense>
  );
}
