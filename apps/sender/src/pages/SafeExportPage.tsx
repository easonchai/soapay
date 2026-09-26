import { PageHead } from "@soapay/ui";
import type { SafeExportChunk } from "../lib/safeExport.js";
import { Notice, short } from "../ui/kit.js";

export type SafeExportPageProps = {
  chunks: SafeExportChunk[];
  onDownload(index: number): void;
  onOpenRun(): void;
  onNewRun(): void;
};

/** Download the Transaction Builder files for a Safe-paid run. */
export function SafeExportPage(p: SafeExportPageProps) {
  return (
    <div className="stack-lg" style={{ maxWidth: 760 }}>
      <PageHead
        eyebrow={`Safe export · ${p.chunks.length} part${p.chunks.length === 1 ? "" : "s"}`}
        title="Execute this run in your Safe"
        line="Import each file into Safe{Wallet} → Transaction Builder and execute every part."
      />
      <Notice tone="info">
        Each part DELEGATECALLs MultiSendCallOnly ({short(p.chunks[0]?.multiSend.to ?? "")}) and pays and announces its lines. Never use MultiSend.
      </Notice>
      <div className="table">
        <div className="thead" style={{ gridTemplateColumns: "1fr 100px 2fr 120px" }}>
          <span>Part</span>
          <span className="r">Lines</span>
          <span>File</span>
          <span />
        </div>
        {p.chunks.map((c) => (
          <div key={c.index} className="tr" style={{ gridTemplateColumns: "1fr 100px 2fr 120px" }}>
            <span>
              Part {c.index + 1} of {p.chunks.length}
            </span>
            <span className="r mono">{c.lines}</span>
            <span className="mono ink2">{c.fileName}</span>
            <span className="r">
              <button className="btn-inline" onClick={() => p.onDownload(c.index)}>
                Download
              </button>
            </span>
          </div>
        ))}
      </div>
      <div className="actions">
        <button className="btn-primary" onClick={p.onOpenRun}>
          Open run record
        </button>
        <button onClick={p.onNewRun}>New pay run</button>
      </div>
    </div>
  );
}
