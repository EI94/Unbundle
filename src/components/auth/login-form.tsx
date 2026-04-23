"use client";

import { useState, useMemo, Suspense } from "react";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
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
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

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
    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(firebaseAuth, provider);
      const idToken = await result.user.getIdToken();
      await exchangeToken(idToken);
      router.push(afterLogin ?? "/dashboard");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Errore login Google";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    try {
      if (mode === "reset") {
        await sendPasswordResetEmail(firebaseAuth, email);
        toast.success("Email di reset inviata. Controlla la posta.");
        setMode("login");
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
      const code =
        err && typeof err === "object" && "code" in err
          ? (err as { code: string }).code
          : "";
      const messages: Record<string, string> = {
        "auth/email-already-in-use": "Questa email e' gia' registrata. Prova ad accedere.",
        "auth/invalid-email": "Email non valida.",
        "auth/weak-password": "La password deve avere almeno 6 caratteri.",
        "auth/user-not-found": "Nessun account con questa email.",
        "auth/wrong-password": "Password errata.",
        "auth/invalid-credential": "Credenziali non valide. Controlla email e password.",
        "auth/too-many-requests": "Troppi tentativi. Riprova tra qualche minuto.",
      };
      toast.error(messages[code] ?? `Errore: ${code || (err instanceof Error ? err.message : "sconosciuto")}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      <button
        onClick={handleGoogle}
        disabled={loading}
        className="w-full flex items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 py-3 text-sm font-medium hover:bg-accent transition-colors disabled:opacity-50"
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
          className="w-full rounded-lg bg-foreground text-background px-4 py-3 text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin inline" />}
          {mode === "login"
            ? "Accedi"
            : mode === "register"
              ? "Crea Account"
              : "Invia link di reset"}
        </button>
      </form>

      <div className="flex flex-col items-center gap-1.5 text-xs">
        {mode === "login" && (
          <>
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setMode("register")}
            >
              Non hai un account? Registrati
            </button>
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setMode("reset")}
            >
              Password dimenticata?
            </button>
          </>
        )}
        {mode === "register" && (
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setMode("login")}
          >
            Hai gi&agrave; un account? Accedi
          </button>
        )}
        {mode === "reset" && (
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setMode("login")}
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
