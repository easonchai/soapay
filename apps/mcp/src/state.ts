/**
 * Local state, one JSON file under STATE_DIR (mode 0600, written atomically):
 * - the daily USDC spend counter behind MAX_PER_DAY_USDC;
 * - pinned meta-addresses (name → st:eth:…), the sender-app pinning rule;
 * - the consolidation guard's ClusterGraph;
 * - the agent's own name once `create_agent_identity` ran.
 * Holds no keys: only public addresses and meta-addresses.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ClusterGraph, type ClusterGraphJSON } from "@soapay/sdk";

export type StateData = {
  version: 1;
  /** UTC day (YYYY-MM-DD) and base units spent on it. */
  spend: { day: string; usdc: string };
  pins: Record<string, string>;
  guard: ClusterGraphJSON | null;
  identity: { label: string; name: string; registrant: string } | null;
};

export interface StateStore {
  read(): StateData;
  write(data: StateData): void;
}

export function emptyState(): StateData {
  return { version: 1, spend: { day: "", usdc: "0" }, pins: {}, guard: null, identity: null };
}

export function fileStateStore(dir: string): StateStore {
  const path = join(dir, "state.json");
  return {
    read() {
      if (!existsSync(path)) return emptyState();
      const data = JSON.parse(readFileSync(path, "utf8")) as Partial<StateData>;
      if (data.version !== 1) throw new Error(`unsupported state file version in ${path}`);
      return { ...emptyState(), ...data } as StateData;
    },
    write(data) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const tmp = `${path}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
      renameSync(tmp, path);
      chmodSync(path, 0o600);
    },
  };
}

export function memoryStateStore(initial: StateData = emptyState()): StateStore & { data: StateData } {
  const s = { data: structuredClone(initial) } as StateStore & { data: StateData };
  s.read = () => structuredClone(s.data);
  s.write = (d) => {
    s.data = structuredClone(d);
  };
  return s;
}

/** Read-modify-write helper. */
export function update(store: StateStore, fn: (d: StateData) => void): StateData {
  const d = store.read();
  fn(d);
  store.write(d);
  return d;
}

export function loadGraph(d: StateData): ClusterGraph {
  return d.guard ? ClusterGraph.fromJSON(d.guard) : new ClusterGraph();
}
