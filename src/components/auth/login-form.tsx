"use client";

import { useEffect, useState, useMemo, Suspense } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

type Mode = "login" | "register" | "reset";

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
  const [suggestRegister, setSuggestRegister] = useState(false);
  const [inAppBrowser, setInAppBrowser] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  useEffect(() => {
    // Letto dopo il montaggio: lo user agent non esiste durante il rendering sul server.
    setInAppBrowser(isInAppBrowser(navigator.userAgent));
  }, []);

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
      throw new Error(body.error ?? "Errore durante la creazione della sessione");
    }
  }

  async function handleGoogle() {
    setLoading(true);
    setError(null);
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
        setInAppBrowser(true);
        setError("Questo browser non apre la finestra di Google. Apri il link in Safari o Chrome, oppure usa email e password qui sotto.");
      } else if (code) {
        setError(firebaseErrorMessage(err));
      } else {
        setError(err instanceof Error && err.message ? err.message : "Accesso con Google non riuscito. Riprova.");
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuggestRegister(false);

    try {
      if (mode === "reset") {
        await sendPasswordResetEmail(firebaseAuth, email);
        toast.success("Email di reset inviata. Controlla la posta.");
        switchMode("login");
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
        setError("Email o password non corrette.");
      } else if (code) {
        setError(firebaseErrorMessage(err));
      } else {
        setError(err instanceof Error && err.message ? err.message : "Accesso non riuscito. Riprova.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      {inAppBrowser && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-3 text-sm text-amber-100" role="status" data-testid="in-app-browser-hint">
          <p>
            Sembra che tu abbia aperto il link dentro un&apos;app (WhatsApp, Teams…): lì l&apos;accesso con Google
            spesso non funziona. Apri il link in Safari o Chrome, oppure usa email e password.
          </p>
          <button type="button" onClick={copyPageLink} className="mt-2 inline-flex h-10 items-center rounded-lg border border-amber-500/40 px-3 text-sm font-medium">
            {linkCopied ? "Link copiato: incollalo nel browser" : "Copia il link"}
          </button>
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200" role="alert" data-testid="login-error">
          <p>{error}</p>
          {suggestRegister && (
            <button
              type="button"
              className="mt-1 font-medium underline underline-offset-4"
              onClick={() => switchMode("register")}
            >
              Primo accesso? Crea l&apos;account con questa email
            </button>
          )}
        </div>
      )}
      <button
        onClick={handleGoogle}
        disabled={loading}
        className="w-full flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 py-3 text-sm font-medium hover:bg-accent transition-colors disabled:opacity-50"
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <svg className="h-4 w-4" viewBox="0 0 24 24">
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
        Continua con Google
      </button>

      <div className="flex items-center gap-4">
        <div className="flex-1 h-px bg-border" />
        <span className="text-xs text-muted-foreground">oppure</span>
        <div className="flex-1 h-px bg-border" />
      </div>

      <form onSubmit={handleEmailSubmit} className="space-y-4">
        {mode === "register" && (
          <div className="space-y-1.5">
            <Label htmlFor="name" className="text-xs text-muted-foreground">Nome</Label>
            <Input
              id="name"
              type="text"
              placeholder="Mario Rossi"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={loading}
              className="bg-card border-border"
            />
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="email" className="text-xs text-muted-foreground">Email</Label>
          <Input
            id="email"
            type="email"
            placeholder="tu@azienda.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={loading}
            className="bg-card border-border"
          />
        </div>

        {mode !== "reset" && (
          <div className="space-y-1.5">
            <Label htmlFor="password" className="text-xs text-muted-foreground">Password</Label>
            <Input
              id="password"
              type="password"
              placeholder="Minimo 6 caratteri"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              disabled={loading}
              className="bg-card border-border"
            />
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full min-h-11 rounded-lg bg-foreground text-background px-4 py-3 text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin inline" />}
          {mode === "login"
            ? "Accedi"
            : mode === "register"
              ? "Crea account"
              : "Invia link di reset"}
        </button>
      </form>

      <div className="flex flex-col items-center gap-1.5 text-xs">
        {mode === "login" && (
          <>
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => switchMode("register")}
            >
              Non hai un account? Registrati
            </button>
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => switchMode("reset")}
            >
              Password dimenticata?
            </button>
          </>
        )}
        {mode === "register" && (
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => switchMode("login")}
          >
            Hai gi&agrave; un account? Accedi
          </button>
        )}
        {mode === "reset" && (
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => switchMode("login")}
          >
            Torna al login
          </button>
        )}
      </div>
    </div>
  );
}

export function LoginForm() {
  return (
    <Suspense fallback={<div className="h-40 flex items-center justify-center text-sm text-muted-foreground">Caricamento…</div>}>
      <LoginFormInner />
    </Suspense>
  );
}
