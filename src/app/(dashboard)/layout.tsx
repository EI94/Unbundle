import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import type { Metadata } from "next";

/** Tutta l'area dashboard è gated. Nessun crawler dovrebbe seguirla — il
 *  middleware redirect già a /login, ma rendiamo esplicito il noindex/nofollow
 *  così se mai un bot riuscisse a colpire una URL non viene indicizzata. */
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true, noarchive: true },
};

/** Solo auth: la sidebar per `/dashboard` è in `DashboardListShell`; per workspace in `[workspaceId]/layout`. */
export default async function DashboardRootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  // `session=stale` dice al proxy di cancellare il cookie __session: senza,
  // un cookie presente ma revocato (utente eliminato, sessione revocata)
  // causerebbe un redirect loop /login ↔ /dashboard.
  if (!session?.user) redirect("/login?session=stale");

  return <>{children}</>;
}
