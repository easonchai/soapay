import type { RunView } from "../hooks/useRunActions.js";
import { formatUsdc } from "../lib/amount.js";
import { Badge, Card } from "../ui/kit.js";
import { statusTone } from "./RunDetailPage.js";

export type HistoryPageProps = { runs: RunView[]; onOpen(id: string): void };

/** Props-only: every recorded run, newest first. */
export function HistoryPage(p: HistoryPageProps) {
  return (
    <Card title="History">
      {p.runs.length === 0 ? (
        <p className="text-sm text-slate-500">No runs yet.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="text-slate-500">
            <tr>
              <th className="py-1">Date</th>
              <th>Path</th>
              <th>Employees</th>
              <th>Planned</th>
              <th>Paid</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {p.runs.map((v) => (
              <tr key={v.run.id} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50" onClick={() => p.onOpen(v.run.id)}>
                <td className="py-1.5">{new Date(v.run.createdAt).toLocaleString()}</td>
                <td>{v.run.path}</td>
                <td>{v.report.length}</td>
                <td>{formatUsdc(v.totals.planned)}</td>
                <td>{formatUsdc(v.totals.paid)}</td>
                <td>
                  <Badge tone={statusTone(v.status)}>{v.executing ? "executing" : v.status}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
