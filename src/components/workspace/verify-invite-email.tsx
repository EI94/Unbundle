"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, sendEmailVerification, type User } from "firebase/auth";
import { firebaseAuth } from "@/lib/firebase/client";
import { firebaseErrorMessage } from "@/lib/firebase/auth-errors";
import { INVITE_TEXT, fillInvite } from "@/lib/public/invite";
import { PUBLIC_PRIMARY, PUBLIC_SECONDARY } from "@/components/public/classes";
import { Button } from "@/components/ui/button";
import { SwitchAccountButton } from "./switch-account-button";

const V = INVITE_TEXT.verify;

/**
 * Un invito riservato a un'email vale solo per chi controlla quella casella.
 * Con Google è già dimostrato; con email e password serve il link di
 * conferma di Firebase. Dopo il clic sul link, «Ho confermato» rinnova la
 * sessione e la pagina mostra il pulsante per entrare: niente nuovo accesso.
 *
 * (Rilascio 10, ondata 4, PROPOSTA-10 §3.11) Nel guscio chiaro delle pagine pubbliche: colori del tema, niente
 * «Firebase» a schermo, il pulsante principale a 48 px. I testi stanno in `src/lib/public/invite.ts`.
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
      setMessage({ error: false, text: fillInvite(V.sent, { Email: email }) });
    } catch (err) {
      setStatus("idle");
      setMessage({ error: true, text: firebaseErrorMessage(err, V.sendFailed) });
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
        setMessage({ error: true, text: before === "idle" ? V.notYetIdle : V.notYet });
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
      setMessage({ error: false, text: V.received });
    } catch {
      setStatus("sent");
      setMessage({ error: true, text: V.refreshFailed });
    }
  }

  return (
    <div className="space-y-3" data-testid="invite-verify-email">
      <div className="rounded-xl bg-uc-giallo-bg px-4 py-3">
        <p className="font-medium">{V.title}</p>
        <p className="mt-1 break-words">{fillInvite(V.body, { Email: email })}</p>
      </div>
      {mismatch ? (
        <div className="space-y-2">
          <p className="text-muted-foreground break-words">{fillInvite(V.mismatch, { Altra: user?.email ?? "", Email: email })}</p>
          <SwitchAccountButton loginHref={loginHref} />
        </div>
      ) : user === null ? (
        <div className="space-y-2">
          <p className="text-muted-foreground break-words">{fillInvite(V.newLogin, { Email: email })}</p>
          <SwitchAccountButton loginHref={loginHref} />
        </div>
      ) : status === "idle" || status === "sending" ? (
        <div className="space-y-2">
          <Button type="button" className={PUBLIC_PRIMARY} disabled={!user || status === "sending"} onClick={send}>
            {status === "sending" ? V.sending : V.send}
          </Button>
          <Button type="button" variant="outline" className={PUBLIC_SECONDARY} disabled={!user} onClick={confirmed}>
            {V.already}
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <Button type="button" className={PUBLIC_PRIMARY} disabled={status === "checking"} onClick={confirmed}>
            {status === "checking" ? V.checking : V.confirmed}
          </Button>
          <Button type="button" variant="outline" className={PUBLIC_SECONDARY} onClick={send}>
            {V.resend}
          </Button>
        </div>
      )}
      {message && (
        <p role={message.error ? "alert" : "status"} className={message.error ? "text-destructive" : "text-muted-foreground"}>
          {message.text}
        </p>
      )}
      <p className="text-sm text-muted-foreground">{V.google}</p>
    </div>
  );
}
