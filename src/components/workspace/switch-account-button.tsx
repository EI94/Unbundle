"use client";

import { useState, type ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { endAppSession } from "@/lib/auth/end-session";
import { cn } from "@/lib/utils";

/**
 * "Cambia account" stile Slack: chiude la sessione corrente e porta al login
 * mantenendo il ritorno all'invito. Senza questo, chi apre un invito
 * riservato a un'altra email resta in un vicolo cieco. La sessione si chiude
 * come con «Esci»: le bozze della board dell'activity mapping lasciano il
 * dispositivo prima (endAppSession).
 *
 * (Rilascio 10, ondata 4) `variant` e `className` da chi lo usa: sulle pagine pubbliche, quando è l'azione principale,
 * pieno, a tutta larghezza e alto 48 px; dentro «Non sei tu? ▸», bordato.
 */
export function SwitchAccountButton({
  loginHref,
  variant = "default",
  className,
}: {
  loginHref: string;
  variant?: ComponentProps<typeof Button>["variant"];
  className?: string;
}) {
  const [pending, setPending] = useState(false);

  async function switchAccount() {
    setPending(true);
    try {
      await endAppSession();
    } catch {
      // anche se la revoca fallisce, il login sovrascriverà la sessione
    }
    window.location.href = loginHref;
  }

  return (
    <Button
      type="button"
      variant={variant}
      className={cn("w-full", className)}
      onClick={switchAccount}
      disabled={pending}
      data-testid="switch-account"
    >
      {pending ? "Un attimo..." : "Cambia account"}
    </Button>
  );
}
