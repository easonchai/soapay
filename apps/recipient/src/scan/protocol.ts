import { scanAnnouncementsWithStats, type AnnouncementRecord, type ScanKeys, type ScanMatch, type ScanStats } from "@soapay/sdk";

/**
 * Main thread → scan worker. The worker holds the viewing key only for the duration of one job; the
 * spending *private* key is never sent (scanning needs only the spending public key).
 */
export type ScanRequest = { id: number; announcements: AnnouncementRecord[]; keys: ScanKeys };

export type ScanResponse =
  | { id: number; type: "progress"; scanned: number }
  | { id: number; type: "done"; matches: ScanMatch[]; stats: ScanStats }
  | { id: number; type: "error"; message: string };

/** Report progress every this many announcements (~0.4 s of work at 1.5 ms each). */
export const PROGRESS_EVERY = 256;

/** The whole worker, as a pure function, so tests can run it in-process. */
export function handleScanRequest(req: ScanRequest, post: (r: ScanResponse) => void): void {
  try {
    const matches: ScanMatch[] = [];
    const stats: ScanStats = { scanned: 0, malformed: 0, fullChecks: 0, matches: 0 };
    for (let i = 0; i < req.announcements.length; i += PROGRESS_EVERY) {
      const slice = req.announcements.slice(i, i + PROGRESS_EVERY);
      const r = scanAnnouncementsWithStats(slice, req.keys);
      matches.push(...r.matches);
      stats.scanned += r.stats.scanned;
      stats.malformed += r.stats.malformed;
      stats.fullChecks += r.stats.fullChecks;
      stats.matches += r.stats.matches;
      post({ id: req.id, type: "progress", scanned: stats.scanned });
    }
    post({ id: req.id, type: "done", matches, stats });
  } catch (e) {
    post({ id: req.id, type: "error", message: e instanceof Error ? e.message : String(e) });
  }
}
