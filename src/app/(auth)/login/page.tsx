import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/login-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default async function LoginPage() {
  const session = await auth();
  if (session) redirect("/dashboard");

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <h1 className="text-4xl font-bold tracking-tight text-foreground">
            Unbundle
          </h1>
          <p className="mt-2 text-muted-foreground">
            Scomponi il lavoro. Leggi il valore. Trasforma l&apos;organizzazione.
          </p>
        </div>

        <Card>
          <CardHeader className="text-center">
            <CardTitle>Accedi alla piattaforma</CardTitle>
            <CardDescription>
              Usa Google o email e password per iniziare
            </CardDescription>
          </CardHeader>
          <CardContent>
            <LoginForm />
          </CardContent>
        </Card>

        <p className="text-center text-sm text-muted-foreground">
          Accedendo accetti i{" "}
          <a href="#" className="underline hover:text-foreground">
            Termini di Servizio
          </a>{" "}
          e la{" "}
          <a href="#" className="underline hover:text-foreground">
            Privacy Policy
          </a>
        </p>
      </div>
    </div>
  );
}
