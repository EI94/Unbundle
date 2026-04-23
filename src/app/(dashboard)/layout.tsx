import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";

/** Solo auth: la sidebar per `/dashboard` è in `DashboardListShell`; per workspace in `[workspaceId]/layout`. */
export default async function DashboardRootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return <>{children}</>;
}
