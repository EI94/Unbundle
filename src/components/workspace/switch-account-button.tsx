"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { endAppSession } from "@/lib/auth/end-session";

/**
 * "Cambia account" stile Slack: chiude la sessione corrente e porta al login
 * mantenendo il ritorno all'invito. Senza questo, chi apre un invito
 * riservato a un'altra email resta in un vicolo cieco. La sessione si chiude
 * come con «Esci»: le bozze della board dell'activity mapping lasciano il
 * dispositivo prima (endAppSession).
 */
export function SwitchAccountButton({ loginHref }: { loginHref: string }) {
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
      className="w-full"
      onClick={switchAccount}
      disabled={pending}
      data-testid="switch-account"
    >
      {pending ? "Un attimo..." : "Cambia account"}
    </Button>
  );
}
