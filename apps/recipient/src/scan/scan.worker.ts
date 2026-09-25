/// <reference lib="webworker" />
import { handleScanRequest, type ScanRequest, type ScanResponse } from "./protocol.js";

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = (e: MessageEvent<ScanRequest>) => {
  handleScanRequest(e.data, (r: ScanResponse) => self.postMessage(r));
};
