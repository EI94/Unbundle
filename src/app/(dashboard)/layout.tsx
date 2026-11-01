import { requireSession } from "@/lib/auth/redirect-to-login";
import type { Metadata } from "next";

/** Tutta l'area dashboard è gated. Nessun crawler dovrebbe seguirla — il
 *  middleware redirect già a /login, ma rendiamo esplicito il noindex/nofollow
 *  così se mai un bot riuscisse a colpire una URL non viene indicizzata. */
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true, noarchive: true },
};

/**
 * Solo auth: la sidebar per `/dashboard` è in `DashboardListShell`; per workspace in `[workspaceId]/layout`.
 * `data-theme-scope`: il segno delle pagine del dashboard, dove vale il tema «Chiaro» quando chi
 * guarda l'ha scelto (globals.css, src/components/theme/). `contents`: nessun riquadro in più.
 */
export default async function DashboardRootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireSession();

  return (
    <div data-theme-scope="" className="contents">
      {children}
    </div>
  );
}
