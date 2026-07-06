import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function RespondentPrivacyControls({ token }: { token: string }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <form
        action={`/api/ai-readiness/respondents/${token}/benchmark-consent`}
        method="post"
        className="rounded-3xl border p-4"
      >
        <h2 className="font-semibold">Revoca benchmark</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Manteniamo le risposte per l&apos;assessment interno, ma non le usiamo
          piu in benchmark aggregati futuri.
        </p>
        <Button className="mt-4" type="submit" variant="outline">
          Revoca consenso benchmark
        </Button>
      </form>

      <form
        action={`/api/ai-readiness/respondents/${token}/anonymize`}
        method="post"
        className="rounded-3xl border border-destructive/30 p-4"
      >
        <h2 className="font-semibold">Anonimizza risposte</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Rimuove dati identificativi, risposte e testi liberi collegati a questo
          token. L&apos;azione non e reversibile.
        </p>
        <div className="mt-4 space-y-1.5">
          <Label htmlFor="confirmation">Scrivi ANONIMIZZA</Label>
          <Input id="confirmation" name="confirmation" placeholder="ANONIMIZZA" />
        </div>
        <Button className="mt-4" type="submit" variant="destructive">
          Anonimizza
        </Button>
      </form>
    </div>
  );
}
