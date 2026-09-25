/**
 * Consolidation guard (PRD Flow 4, SDK P1). Pure: no I/O, no clock, no randomness,
 * so wallets can embed it and the recipient app can persist it encrypted.
 *
 * Model: a union-find over every address the user has touched. Stealth addresses
 * start as singleton clusters. A spend unions its source addresses and its
 * destination into one cluster, which is exactly the link an observer (here: a
 * coworker who reads the batch and knows colleagues' main wallets) can draw.
 * A cluster is *identified* once any member carries an identifiable label.
 */
import { getAddress, isAddress, type Address } from "viem";

export type AddressLabel = "main-wallet" | "exchange" | "coworker-known" | "other";

export type GuardPolicy = {
  /** Labels that make an address identifiable to the adversary. */
  identifiableLabels: readonly AddressLabel[];
};

/**
 * Under the agreed threat model the adversary is a coworker who likely knows
 * colleagues' main wallets, so `coworker-known` and `main-wallet` are identifiable.
 * `exchange` is included because a deposit address resolves to a KYC identity and
 * is reused across payments. `other` is tracked but not identifiable by default.
 */
export const DEFAULT_GUARD_POLICY: GuardPolicy = {
  identifiableLabels: ["main-wallet", "coworker-known", "exchange"],
};

export type StealthMeta = {
  /** Pay run the funds arrived in; chunks of one salary share a run id. */
  runId?: string;
  /** Amount received, for the amount-leak heuristic and display only. */
  amount?: bigint;
};

type NodeKind = "stealth" | "external";

type Node = {
  address: Address;
  kind: NodeKind;
  label?: AddressLabel;
  runId?: string;
  amount?: bigint;
};

export type ClusterInfo = {
  /** Representative address. Stable until the next merge touching this cluster. */
  id: Address;
  stealth: Address[];
  /** Non-stealth addresses this cluster has sent to. */
  destinations: Address[];
  labels: AddressLabel[];
  identified: boolean;
};

export type SpendRequest = {
  from: readonly Address[];
  to: Address;
  /** Explicit user override for a spend that would otherwise be blocked. */
  override?: boolean;
};

export type GuardWarningCode =
  | "merge-clusters"
  | "reuse-destination"
  | "identifiable-destination"
  | "override-used"
  | "amount-leak"
  | "already-linked";

export type GuardWarning = { code: GuardWarningCode; message: string };

export type SpendPlan = {
  from: Address[];
  to: Address;
  override: boolean;
  /** Ids of every existing cluster the spend touches (sources plus a known destination). */
  mergedClusterIds: Address[];
  /** True when the spend links two or more previously separate stealth clusters. */
  wouldMerge: boolean;
  /** True when the destination is labelled identifiable or sits in an identified cluster. */
  identifiable: boolean;
  decision: "allow" | "warn" | "block";
  reason: string;
  warnings: GuardWarning[];
};

export type BalanceMap = ReadonlyMap<Address, bigint> | Readonly<Record<string, bigint>>;

export type BalanceCluster = {
  id: Address;
  identified: boolean;
  labels: AddressLabel[];
  total: bigint;
  addresses: { address: Address; balance: bigint }[];
};

export type BalanceView = { total: bigint; clusters: BalanceCluster[] };

export type SourceSuggestion = {
  from: Address[];
  clusterIds: Address[];
  /** Number of cluster merges this spend would create (clusters used minus one). */
  merges: number;
  total: bigint;
  sufficient: boolean;
};

export type ClusterGraphJSON = {
  version: 1;
  policy: { identifiableLabels: AddressLabel[] };
  nodes: { address: Address; kind: NodeKind; label?: AddressLabel; runId?: string; amount?: string }[];
  /** Each entry lists the members of one multi-address cluster. */
  clusters: Address[][];
};

const LABELS: readonly AddressLabel[] = ["main-wallet", "exchange", "coworker-known", "other"];

function key(address: string): string {
  if (!isAddress(address, { strict: false })) throw new Error(`guard: invalid address ${address}`);
  return address.toLowerCase();
}

export class ClusterGraph {
  readonly policy: GuardPolicy;
  private readonly nodes = new Map<string, Node>();
  private readonly parent = new Map<string, string>();
  private readonly size = new Map<string, number>();

  constructor(policy: GuardPolicy = DEFAULT_GUARD_POLICY) {
    this.policy = { identifiableLabels: [...policy.identifiableLabels] };
  }

  /** Registers a stealth address (idempotent). Metadata fills gaps, never overwrites. */
  addStealth(address: Address, meta: StealthMeta = {}): this {
    const node = this.ensure(address, "stealth");
    node.kind = "stealth";
    if (meta.runId !== undefined && node.runId === undefined) node.runId = meta.runId;
    if (meta.amount !== undefined && node.amount === undefined) node.amount = meta.amount;
    return this;
  }

  /** Sets (or with `undefined`, clears) the user's label on any address. */
  setLabel(address: Address, label: AddressLabel | undefined): this {
    if (label !== undefined && !LABELS.includes(label)) throw new Error(`guard: unknown label ${label}`);
    const node = this.ensure(address, "external");
    if (label === undefined) delete node.label;
    else node.label = label;
    return this;
  }

  has(address: Address): boolean {
    return this.nodes.has(key(address));
  }

  isStealth(address: Address): boolean {
    return this.nodes.get(key(address))?.kind === "stealth";
  }

  labelOf(address: Address): AddressLabel | undefined {
    return this.nodes.get(key(address))?.label;
  }

  runIdOf(address: Address): string | undefined {
    return this.nodes.get(key(address))?.runId;
  }

  /** Registers a non-stealth address (idempotent), e.g. a destination. */
  addExternal(address: Address): this {
    this.ensure(address, "external");
    return this;
  }

  /** Cluster id of a known address, or undefined for an address never seen. */
  clusterOf(address: Address): Address | undefined {
    const k = key(address);
    if (!this.nodes.has(k)) return undefined;
    return this.nodes.get(this.find(k))!.address;
  }

  cluster(id: Address): ClusterInfo {
    const root = this.find(key(id));
    const members = [...this.nodes.keys()].filter((k) => this.find(k) === root).map((k) => this.nodes.get(k)!);
    const labels = [...new Set(members.flatMap((n) => (n.label ? [n.label] : [])))];
    return {
      id: this.nodes.get(root)!.address,
      stealth: members.filter((n) => n.kind === "stealth").map((n) => n.address),
      destinations: members.filter((n) => n.kind === "external").map((n) => n.address),
      labels,
      identified: labels.some((l) => this.policy.identifiableLabels.includes(l)),
    };
  }

  clusters(): ClusterInfo[] {
    const roots = new Set([...this.nodes.keys()].map((k) => this.find(k)));
    return [...roots].map((r) => this.cluster(this.nodes.get(r)!.address));
  }

  /** @internal union of the given addresses; used by applySpend and fromJSON. */
  unionAll(addresses: readonly Address[]): void {
    const keys = addresses.map(key);
    const [first, ...rest] = keys;
    if (first === undefined) return;
    for (const k of rest) this.union(first, k);
  }

  toJSON(): ClusterGraphJSON {
    const nodes = [...this.nodes.values()].map((n) => {
      const out: ClusterGraphJSON["nodes"][number] = { address: n.address, kind: n.kind };
      if (n.label !== undefined) out.label = n.label;
      if (n.runId !== undefined) out.runId = n.runId;
      if (n.amount !== undefined) out.amount = n.amount.toString();
      return out;
    });
    const groups = new Map<string, Address[]>();
    for (const [k, n] of this.nodes) {
      const r = this.find(k);
      const g = groups.get(r) ?? [];
      g.push(n.address);
      groups.set(r, g);
    }
    return {
      version: 1,
      policy: { identifiableLabels: [...this.policy.identifiableLabels] },
      nodes,
      clusters: [...groups.values()].filter((g) => g.length > 1),
    };
  }

  static fromJSON(json: ClusterGraphJSON | string): ClusterGraph {
    const data: ClusterGraphJSON = typeof json === "string" ? JSON.parse(json) : json;
    if (data.version !== 1) throw new Error(`guard: unsupported graph version ${String(data.version)}`);
    const g = new ClusterGraph({ identifiableLabels: data.policy.identifiableLabels });
    for (const n of data.nodes) {
      if (n.kind === "stealth") {
        const meta: StealthMeta = {};
        if (n.runId !== undefined) meta.runId = n.runId;
        if (n.amount !== undefined) meta.amount = BigInt(n.amount);
        g.addStealth(n.address, meta);
      } else {
        g.addExternal(n.address);
      }
      if (n.label !== undefined) g.setLabel(n.address, n.label);
    }
    for (const group of data.clusters) g.unionAll(group);
    return g;
  }

  private ensure(address: Address, kind: NodeKind): Node {
    const k = key(address);
    let node = this.nodes.get(k);
    if (!node) {
      node = { address: getAddress(address), kind };
      this.nodes.set(k, node);
      this.parent.set(k, k);
      this.size.set(k, 1);
    }
    return node;
  }

  private find(k: string): string {
    if (!this.parent.has(k)) throw new Error(`guard: unknown address ${k}`);
    let root = k;
    while (this.parent.get(root) !== root) root = this.parent.get(root)!;
    // Path compression.
    let cur = k;
    while (cur !== root) {
      const next = this.parent.get(cur)!;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  private union(a: string, b: string): void {
    let ra = this.find(a);
    let rb = this.find(b);
    if (ra === rb) return;
    if ((this.size.get(ra) ?? 1) < (this.size.get(rb) ?? 1)) [ra, rb] = [rb, ra];
    this.parent.set(rb, ra);
    this.size.set(ra, (this.size.get(ra) ?? 1) + (this.size.get(rb) ?? 1));
  }
}

/**
 * Evaluates a spend without mutating the graph. Rules (PRD Flow 4):
 * - Sources in several clusters, or a destination already used by another cluster,
 *   merge those clusters: warn.
 * - A destination is identifiable when its label is identifiable under the policy,
 *   or it already sits in a cluster that touched such a label (transitively).
 * - Linking a cluster to an identifiable destination: block unless `override`.
 * - Merging denominated chunks from the same pay run reveals the salary total: warn.
 * Unknown source addresses are treated as fresh stealth singletons.
 */
export function planSpend(graph: ClusterGraph, req: SpendRequest): SpendPlan {
  if (req.from.length === 0) throw new Error("guard: planSpend needs at least one source address");
  const override = req.override === true;
  const from = [...new Map(req.from.map((a) => [key(a), getAddress(a)])).values()];
  const to = getAddress(req.to);
  const toKey = key(to);
  if (from.some((a) => key(a) === toKey)) throw new Error("guard: destination is one of the sources");

  const warnings: GuardWarning[] = [];
  const clusterIdOf = (a: Address): Address => graph.clusterOf(a) ?? a;

  const sourceClusters = [...new Set(from.map(clusterIdOf))];
  const destCluster = graph.clusterOf(to);
  const mergedClusterIds = [...new Set(destCluster ? [...sourceClusters, destCluster] : sourceClusters)];
  // Stealth clusters that end up linked by this spend.
  const stealthClusterIds = mergedClusterIds.filter((id) =>
    graph.has(id) ? graph.cluster(id).stealth.length > 0 : true,
  );
  const wouldMerge = stealthClusterIds.length > 1;

  if (sourceClusters.length > 1) {
    warnings.push({
      code: "merge-clusters",
      message: `Spending from ${sourceClusters.length} unlinked clusters in one operation links them to each other.`,
    });
  }
  if (destCluster && !sourceClusters.includes(destCluster) && graph.cluster(destCluster).stealth.length > 0) {
    warnings.push({
      code: "reuse-destination",
      message: "This destination already received from another cluster; reusing it links the two.",
    });
  }

  const destLabel = graph.labelOf(to);
  const labelIdentifiable = destLabel !== undefined && graph.policy.identifiableLabels.includes(destLabel);
  const clusterIdentified = destCluster !== undefined && graph.cluster(destCluster).identified;
  const identifiable = labelIdentifiable || clusterIdentified;
  // Sending more from a cluster already linked to this destination reveals no new link.
  const newLink = sourceClusters.some((c) => c !== destCluster);

  let blocked = false;
  if (identifiable && newLink) {
    const why = labelIdentifiable
      ? `the destination is labelled ${destLabel}`
      : "the destination is already linked to an identifiable address";
    warnings.push({
      code: "identifiable-destination",
      message: `Sending here ties these funds to you: ${why}. Use the shielded exit instead.`,
    });
    if (override) {
      warnings.push({ code: "override-used", message: "Proceeding by explicit override." });
    } else {
      blocked = true;
    }
  } else if (identifiable) {
    warnings.push({
      code: "already-linked",
      message: "These addresses are already linked to this identifiable destination; no new link is created.",
    });
  }

  // Amount leak: chunks of one salary that were unlinked become linked, so their sum shows.
  const runClusters = new Map<string, Set<Address>>();
  for (const id of stealthClusterIds) {
    const members = graph.has(id) ? graph.cluster(id).stealth : [id];
    for (const m of members) {
      const run = graph.runIdOf(m);
      if (run === undefined) continue;
      const set = runClusters.get(run) ?? new Set<Address>();
      set.add(id);
      runClusters.set(run, set);
    }
  }
  const leakingRuns = [...runClusters].filter(([, ids]) => ids.size > 1).map(([run]) => run);
  if (leakingRuns.length > 0) {
    warnings.push({
      code: "amount-leak",
      message: `This combines denominated chunks from the same pay run (${leakingRuns.join(", ")}); the combined amount can reveal your salary.`,
    });
  }

  const decision: SpendPlan["decision"] = blocked
    ? "block"
    : warnings.some((w) => w.code !== "already-linked")
      ? "warn"
      : "allow";
  const reason = blocked
    ? "Blocked: destination is identifiable. Pass override to proceed anyway."
    : decision === "warn"
      ? warnings.map((w) => w.message).join(" ")
      : "No new links are created.";

  return { from, to, override, mergedClusterIds, wouldMerge, identifiable, decision, reason, warnings };
}

/** Records a confirmed spend. Refuses a blocked plan: it should never have been sent. */
export function applySpend(graph: ClusterGraph, plan: SpendPlan): ClusterGraph {
  if (plan.decision === "block") throw new Error("guard: refusing to apply a blocked spend plan");
  for (const a of plan.from) if (!graph.has(a)) graph.addStealth(a);
  graph.addExternal(plan.to);
  graph.unionAll([...plan.from, plan.to]);
  return graph;
}

function entries(balances: BalanceMap): [Address, bigint][] {
  const raw: [string, bigint][] =
    balances instanceof Map ? [...balances] : Object.entries(balances as Record<string, bigint>);
  const merged = new Map<string, [Address, bigint]>();
  for (const [a, b] of raw) {
    const k = key(a);
    const prev = merged.get(k);
    merged.set(k, [getAddress(a), (prev?.[1] ?? 0n) + b]);
  }
  return [...merged.values()];
}

/** Single-balance view grouped by cluster, largest cluster first. Unknown addresses are singletons. */
export function balanceView(graph: ClusterGraph, balances: BalanceMap): BalanceView {
  const byCluster = new Map<Address, BalanceCluster>();
  let total = 0n;
  for (const [address, balance] of entries(balances)) {
    total += balance;
    const known = graph.has(address);
    const info = known ? graph.cluster(address) : undefined;
    const id = info?.id ?? address;
    let c = byCluster.get(id);
    if (!c) {
      c = { id, identified: info?.identified ?? false, labels: info?.labels ?? [], total: 0n, addresses: [] };
      byCluster.set(id, c);
    }
    c.total += balance;
    c.addresses.push({ address, balance });
  }
  const clusters = [...byCluster.values()];
  for (const c of clusters) c.addresses.sort((a, b) => cmpDesc(a.balance, b.balance));
  clusters.sort((a, b) => cmpDesc(a.total, b.total));
  return { total, clusters };
}

/**
 * Picks source addresses for `amount`, preferring the fewest cluster merges, then
 * the fewest addresses, then the smallest overshoot. A single address that covers
 * the amount always wins. Returns `sufficient: false` with every address when the
 * total balance is short.
 */
export function suggestSources(graph: ClusterGraph, balances: BalanceMap, amount: bigint): SourceSuggestion {
  if (amount <= 0n) throw new Error("guard: amount must be positive");
  const view = balanceView(graph, balances);
  const clusters = view.clusters
    .map((c) => ({ ...c, addresses: c.addresses.filter((a) => a.balance > 0n) }))
    .filter((c) => c.addresses.length > 0);

  // One cluster: minimum address count via largest-first, tie-break on overshoot.
  let best: { from: Address[]; total: bigint; id: Address } | undefined;
  for (const c of clusters) {
    if (c.total < amount) continue;
    const pick = coverLargestFirst(c.addresses, amount);
    const better =
      !best ||
      pick.from.length < best.from.length ||
      (pick.from.length === best.from.length && pick.total < best.total);
    if (better) best = { ...pick, id: c.id };
  }
  if (best) return { from: best.from, clusterIds: [best.id], merges: 0, total: best.total, sufficient: true };

  // Several clusters: largest totals first minimises the cluster count.
  const from: Address[] = [];
  const clusterIds: Address[] = [];
  let total = 0n;
  for (const c of clusters) {
    if (total >= amount) break;
    const need = amount - total;
    const part = c.total <= need ? { from: c.addresses.map((a) => a.address), total: c.total } : coverLargestFirst(c.addresses, need);
    from.push(...part.from);
    total += part.total;
    clusterIds.push(c.id);
  }
  return { from, clusterIds, merges: Math.max(0, clusterIds.length - 1), total, sufficient: total >= amount };
}

function coverLargestFirst(
  addresses: readonly { address: Address; balance: bigint }[],
  amount: bigint,
): { from: Address[]; total: bigint } {
  const sorted = [...addresses].sort((a, b) => cmpDesc(a.balance, b.balance));
  // Smallest single address that covers the amount, if any.
  const single = [...sorted].reverse().find((a) => a.balance >= amount);
  if (single) return { from: [single.address], total: single.balance };
  const from: Address[] = [];
  let total = 0n;
  for (const a of sorted) {
    if (total >= amount) break;
    from.push(a.address);
    total += a.balance;
  }
  return { from, total };
}

function cmpDesc(a: bigint, b: bigint): number {
  return a === b ? 0 : a > b ? -1 : 1;
}
