"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * "Cambia account" stile Slack: chiude la sessione corrente e porta al login
 * mantenendo il ritorno all'invito. Senza questo, chi apre un invito
 * riservato a un'altra email resta in un vicolo cieco.
 */
export function SwitchAccountButton({ loginHref }: { loginHref: string }) {
  const [pending, setPending] = useState(false);

  async function switchAccount() {
    setPending(true);
    try {
      await fetch("/api/auth/session", { method: "DELETE" });
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
