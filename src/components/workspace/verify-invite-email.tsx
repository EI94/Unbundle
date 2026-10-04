"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, sendEmailVerification, type User } from "firebase/auth";
import { firebaseAuth } from "@/lib/firebase/client";
import { firebaseErrorMessage } from "@/lib/firebase/auth-errors";
import { Button } from "@/components/ui/button";
import { SwitchAccountButton } from "./switch-account-button";

/**
 * Un invito riservato a un'email vale solo per chi controlla quella casella.
 * Con Google è già dimostrato; con email e password serve il link di
 * conferma di Firebase. Dopo il clic sul link, «Ho confermato» rinnova la
 * sessione e la pagina mostra il pulsante per entrare: niente nuovo accesso.
 */
export function VerifyInviteEmail({ email, loginHref }: { email: string; loginHref: string }) {
  const router = useRouter();
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "checking">("idle");
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);

  useEffect(() => onAuthStateChanged(firebaseAuth, setUser), []);

  // Chi torna dal link della mail arriva qui con l'email già confermata ma
  // con la sessione di prima: la si rinnova da sola, senza chiedere nulla.
  const autoChecked = useRef(false);
  useEffect(() => {
    if (!user || autoChecked.current) return;
    autoChecked.current = true;
    void user.reload().then(() => {
      const current = firebaseAuth.currentUser;
      if (current?.emailVerified && sameAddress(current.email)) void confirmed();
    }).catch(() => undefined);
    // confirmed legge solo stato stabile (user, router): eseguirlo una volta è voluto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const sameAddress = (address: string | null | undefined) =>
    (address ?? "").trim().toLowerCase() === email.trim().toLowerCase();
  // L'account di Firebase in questo browser può essere un altro (cambiato da
  // console, o un secondo accesso): la conferma deve riguardare questa email.
  const mismatch = Boolean(user && !sameAddress(user.email));

  async function send() {
    if (!user || mismatch) return;
    setStatus("sending");
    setMessage(null);
    try {
      try {
        await sendEmailVerification(user, { url: window.location.href });
      } catch {
        // Dominio di ritorno non autorizzato su Firebase: il link funziona lo stesso.
        await sendEmailVerification(user);
      }
      setStatus("sent");
      setMessage({ error: false, text: `Ti abbiamo scritto a ${email}. Apri il link nella mail, poi torna qui e premi «Ho confermato».` });
    } catch (err) {
      setStatus("idle");
      setMessage({ error: true, text: firebaseErrorMessage(err, "Invio non riuscito. Riprova tra un minuto.") });
    }
  }

  async function confirmed() {
    if (!user || mismatch) return;
    const before = status === "idle" ? "idle" : "sent";
    setStatus("checking");
    setMessage(null);
    try {
      await user.reload();
      if (!firebaseAuth.currentUser?.emailVerified) {
        setStatus(before);
        setMessage({
          error: true,
          text: before === "idle"
            ? "Non risulta ancora confermata: mandati il link qui sopra e aprilo dalla mail."
            : "Non risulta ancora confermata. Apri il link nella mail e riprova.",
        });
        return;
      }
      const idToken = await firebaseAuth.currentUser.getIdToken(true);
      const res = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      });
      if (!res.ok) throw new Error("session");
      router.refresh();
      // Se il server non riconosce ancora la conferma, il pannello non resta bloccato.
      setStatus("sent");
      setMessage({ error: false, text: "Conferma ricevuta: aggiorno la pagina…" });
    } catch {
      setStatus("sent");
      setMessage({ error: true, text: "Non è stato possibile aggiornare l'accesso. Ricarica la pagina e riprova." });
    }
  }

  return (
    <div className="space-y-3" data-testid="invite-verify-email">
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-3 text-sm text-amber-100">
        <p className="font-medium text-amber-50">Conferma la tua email per entrare</p>
        <p className="mt-1">
          Questo invito è riservato a <span className="font-medium">{email}</span>. Per sicurezza, prima di entrare
          conferma che la casella è tua: ti mandiamo un link.
        </p>
      </div>
      {mismatch ? (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            In questo browser sei collegato a Google o Firebase con un&apos;altra email ({user?.email}). Esci e rientra
            con {email} per confermarla.
          </p>
          <SwitchAccountButton loginHref={loginHref} />
        </div>
      ) : user === null ? (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Per inviare il link serve un nuovo accesso da questo browser: esci e rientra con {email}.
          </p>
          <SwitchAccountButton loginHref={loginHref} />
        </div>
      ) : status === "idle" || status === "sending" ? (
        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <Button type="button" className="h-11 w-full" disabled={!user || status === "sending"} onClick={send}>
            {status === "sending" ? "Invio in corso…" : "Mandami il link di conferma"}
          </Button>
          <Button type="button" variant="outline" className="h-11" disabled={!user} onClick={confirmed}>
            Ho già confermato
          </Button>
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          <Button type="button" className="h-11 w-full" disabled={status === "checking"} onClick={confirmed}>
            {status === "checking" ? "Controllo…" : "Ho confermato"}
          </Button>
          <Button type="button" variant="outline" className="h-11 w-full" onClick={send}>
            Rimanda il link
          </Button>
        </div>
      )}
      {message && (
        <p role={message.error ? "alert" : "status"} className={`text-sm ${message.error ? "text-red-300" : "text-muted-foreground"}`}>
          {message.text}
        </p>
      )}
      <p className="text-xs text-muted-foreground">Con «Continua con Google» la conferma non serve.</p>
    </div>
  );
}
