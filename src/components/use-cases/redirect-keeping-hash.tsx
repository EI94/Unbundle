"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { isInternalPath, keptHash } from "./kept-hash";

/**
 * Un rinvio interno che tiene l'ancora dell'indirizzo. Il server non vede mai l'ancora, e `redirect()` sotto un
 * `loading.tsx` diventa un rinvio nel browser che la perde (docs di Next: «Streaming», redirect a metà dello stream):
 * qui la si riattacca a `href`. Senza JavaScript resta il link.
 */
export function RedirectKeepingHash({ href, label }: { href: string; label: string }) {
  const router = useRouter();
  useEffect(() => {
    if (!isInternalPath(href)) return;
    router.replace(`${href}${keptHash(window.location.hash)}`);
  }, [href, router]);
  return (
    <p className="p-6 text-sm text-muted-foreground">
      <Link href={href} className="underline underline-offset-4">
        {label}
      </Link>
    </p>
  );
}
