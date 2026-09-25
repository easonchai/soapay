import type { SafeExportChunk } from "../lib/safeExport.js";
import { Banner, Button, Card, short } from "../ui/kit.js";

export type SafeExportPageProps = {
  chunks: SafeExportChunk[];
  onDownload(index: number): void;
  onOpenRun(): void;
};

/** Props-only: download the Transaction Builder files for a Safe-paid run. */
export function SafeExportPage(p: SafeExportPageProps) {
  return (
    <Card title="Safe export">
      <Banner tone="info">
        Import each file into Safe{"{"}Wallet{"}"} → Transaction Builder and execute every part. Each part DELEGATECALLs
        MultiSendCallOnly ({short(p.chunks[0]?.multiSend.to ?? "")}) and pays + announces its lines. Never use MultiSend.
      </Banner>
      <ul className="mt-3 flex flex-col gap-2 text-sm">
        {p.chunks.map((c) => (
          <li key={c.index} className="flex items-center justify-between gap-2 border-t border-slate-100 pt-2">
            <span>
              Part {c.index + 1} of {p.chunks.length}: {c.lines} lines <span className="text-slate-500">({c.fileName})</span>
            </span>
            <Button variant="ghost" onClick={() => p.onDownload(c.index)}>Download</Button>
          </li>
        ))}
      </ul>
      <div className="mt-3">
        <Button variant="ghost" onClick={p.onOpenRun}>Open run record</Button>
      </div>
    </Card>
  );
}
