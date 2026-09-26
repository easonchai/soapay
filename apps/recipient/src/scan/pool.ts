/**
 * Web Worker pool for scanning. Scanning costs one ECDH per announcement (~1.5 ms), so a year of
 * announcements is CPU-bound; this shards the input into fixed-size jobs and hands them to
 * `hardwareConcurrency - 1` workers (the main thread keeps a core for the UI). Jobs are pulled from a
 * shared queue, so a slow core never holds up the rest.
 */
import type { AnnouncementRecord, ScanKeys, ScanMatch, ScanStats } from "@soapay/sdk";
import type { ScanRequest, ScanResponse } from "./protocol.js";

export type WorkerLike = {
  postMessage(msg: ScanRequest): void;
  onmessage: ((e: { data: ScanResponse }) => void) | null;
  onerror: ((e: { message?: string }) => void) | null;
  terminate(): void;
};

export type PoolProgress = { scanned: number; total: number };

export type PoolResult = { matches: ScanMatch[]; stats: ScanStats; ms: number; workers: number };

export class ScanAborted extends Error {
  override name = "ScanAborted";
  constructor() {
    super("Scan cancelled");
  }
}

export function defaultPoolSize(): number {
  const cores = typeof navigator !== "undefined" ? (navigator.hardwareConcurrency ?? 4) : 4;
  return Math.max(1, Math.min(8, cores - 1));
}

/** Browser factory: a module worker bundled by Vite. */
export function browserWorkerFactory(): WorkerLike {
  return new Worker(new URL("./scan.worker.ts", import.meta.url), { type: "module", name: "soapay-scan" }) as unknown as WorkerLike;
}

export class ScanPool {
  private workers: WorkerLike[] = [];
  private nextId = 1;

  constructor(
    private readonly factory: () => WorkerLike,
    readonly size: number = defaultPoolSize(),
    /** Announcements per job. Small enough to balance load, big enough to amortise messaging. */
    readonly jobSize = 1_024,
  ) {}

  async scan(
    announcements: readonly AnnouncementRecord[],
    keys: ScanKeys,
    opts: { onProgress?: (p: PoolProgress) => void; signal?: AbortSignal } = {},
  ): Promise<PoolResult> {
    const t0 = performance.now();
    const total = announcements.length;
    const stats: ScanStats = { scanned: 0, malformed: 0, fullChecks: 0, matches: 0 };
    if (total === 0) return { matches: [], stats, ms: 0, workers: 0 };

    const jobs: AnnouncementRecord[][] = [];
    for (let i = 0; i < total; i += this.jobSize) jobs.push(announcements.slice(i, i + this.jobSize));
    const n = Math.min(this.size, jobs.length);
    while (this.workers.length < n) this.workers.push(this.factory());

    const matches: ScanMatch[] = [];
    const inFlight = new Map<number, number>(); // job id → scanned so far
    let finished = 0; // announcements in completed jobs
    const report = () => {
      let partial = 0;
      for (const v of inFlight.values()) partial += v;
      opts.onProgress?.({ scanned: finished + partial, total });
    };

    await new Promise<void>((resolve, reject) => {
      let next = 0;
      let active = 0;
      let failed = false;
      const fail = (err: Error) => {
        if (failed) return;
        failed = true;
        this.terminate(); // stop in-flight work; workers are recreated on the next scan
        reject(err);
      };
      const onAbort = () => fail(new ScanAborted());
      if (opts.signal?.aborted) return onAbort();
      opts.signal?.addEventListener("abort", onAbort, { once: true });

      const dispatch = (w: WorkerLike) => {
        if (failed) return;
        const job = jobs[next++];
        if (!job) {
          if (active === 0) {
            opts.signal?.removeEventListener("abort", onAbort);
            resolve();
          }
          return;
        }
        const id = this.nextId++;
        active++;
        inFlight.set(id, 0);
        w.onmessage = (e) => {
          const r = e.data;
          if (r.id !== id || failed) return;
          if (r.type === "progress") {
            inFlight.set(id, r.scanned);
            report();
          } else if (r.type === "done") {
            inFlight.delete(id);
            finished += job.length;
            matches.push(...r.matches);
            stats.scanned += r.stats.scanned;
            stats.malformed += r.stats.malformed;
            stats.fullChecks += r.stats.fullChecks;
            stats.matches += r.stats.matches;
            active--;
            report();
            dispatch(w);
          } else {
            fail(new Error(`Scan worker failed: ${r.message}`));
          }
        };
        w.onerror = (e) => fail(new Error(`Scan worker crashed: ${e.message ?? "unknown error"}`));
        w.postMessage({ id, announcements: job, keys });
      };
      for (const w of this.workers.slice(0, n)) dispatch(w);
    });

    matches.sort((a, b) => {
      const x = a.announcement;
      const y = b.announcement;
      return x.blockNumber === y.blockNumber ? x.logIndex - y.logIndex : x.blockNumber < y.blockNumber ? -1 : 1;
    });
    return { matches, stats, ms: performance.now() - t0, workers: n };
  }

  terminate(): void {
    for (const w of this.workers) w.terminate();
    this.workers = [];
  }
}
