import { getSignalsByWorkspace, getUnreadSignals } from "@/lib/db/queries/signals";
import { getActivitiesByWorkspace } from "@/lib/db/queries/activities";
import { getUseCasesByWorkspace } from "@/lib/db/queries/use-cases";
import { SignalsFeed } from "@/components/dashboard/signals-feed";
import { CompetitiveAnalysisViewer } from "@/components/dashboard/competitive-analysis";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Radar,
  Activity,
  Lightbulb,
  AlertTriangle,
  TrendingUp,
} from "lucide-react";

export default async function IntelligencePage(props: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await props.params;

  const [signals, unread, activities, useCases] = await Promise.all([
    getSignalsByWorkspace(workspaceId),
    getUnreadSignals(workspaceId),
    getActivitiesByWorkspace(workspaceId),
    getUseCasesByWorkspace(workspaceId),
  ]);

  const riskSignals = signals.filter((s) => s.signalType === "risk_alert");
  const opportunitySignals = signals.filter(
    (s) => s.signalType === "new_use_case_opportunity"
  );

  const automatable = activities.filter(
    (a) => a.classification === "automate" || a.classification === "automatable"
  );
  const quickWins = useCases.filter(
    (uc) => uc.category === "quick_win"
  );

  return (
    <div className="space-y-6 p-6">
      <div>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Radar className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Competitive Intelligence
            </h1>
            <p className="text-sm text-muted-foreground">
              Monitoraggio continuo del panorama AI e segnali di trasformazione
            </p>
          </div>
          {unread.length > 0 && (
            <Badge variant="destructive" className="ml-auto">
              {unread.length} segnali non letti
            </Badge>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Segnali Totali</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{signals.length}</div>
            <p className="text-xs text-muted-foreground">
              {unread.length} non letti
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Opportunita'</CardTitle>
            <Lightbulb className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{opportunitySignals.length}</div>
            <p className="text-xs text-muted-foreground">
              {quickWins.length} quick wins attivi
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Rischi</CardTitle>
            <AlertTriangle className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{riskSignals.length}</div>
            <p className="text-xs text-muted-foreground">
              alert rilevati
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Automazione</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {activities.length > 0
                ? Math.round((automatable.length / activities.length) * 100)
                : 0}
              %
            </div>
            <p className="text-xs text-muted-foreground">
              {automatable.length} di {activities.length} attivita'
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <SignalsFeed signals={signals} workspaceId={workspaceId} />
        <CompetitiveAnalysisViewer workspaceId={workspaceId} />
      </div>
    </div>
  );
}
