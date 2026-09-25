/**
 * Invite links (docs/mvp-spec.md §7): `${RECIPIENT_URL}/#/join?code=<0x…>&label=<label>&org=<org>`.
 * `label` and `org` in the URL are display hints only; the truth is `GET /invites/keccak256(code)`.
 * Framework-free so any UI can use it.
 */
import { isHex, keccak256, type Hex } from "viem";
import { ApiError, type Api, type InviteRecord } from "../api/client.js";

export type JoinLink = { code: Hex; labelHint?: string; orgHint?: string };

/** Parses `#/join?code=…` (or a full URL containing it). Returns null for anything else or a bad code. */
export function parseJoinLink(input: string): JoinLink | null {
  const hash = input.includes("#") ? input.slice(input.indexOf("#") + 1) : input;
  const m = /^\/?join(?:\?(.*))?$/.exec(hash);
  if (!m) return null;
  const q = new URLSearchParams(m[1] ?? "");
  const code = (q.get("code") ?? "").trim();
  if (!isHex(code, { strict: true }) || code.length !== 66) return null;
  const labelHint = q.get("label")?.trim().toLowerCase();
  const orgHint = q.get("org")?.trim();
  return { code: code.toLowerCase() as Hex, ...(labelHint ? { labelHint } : {}), ...(orgHint ? { orgHint: orgHint.slice(0, 80) } : {}) };
}

export const inviteCodeHash = (code: Hex): Hex => keccak256(code);

export type InviteState =
  | { kind: "none" }
  | { kind: "loading"; link: JoinLink }
  /** Claim `label` with `inviteCode: code`; the label is locked. */
  | { kind: "pending"; code: Hex; label: string; org: string | null; expiresAt: number }
  /** Not usable: say why, then let the employee pick their own label. */
  | { kind: "unusable"; reason: "expired" | "claimed" | "not_found" | "error"; message: string; org: string | null };

const orgOf = (r: InviteRecord | null, link: JoinLink) => r?.org ?? link.orgHint ?? null;

export async function resolveInvite(api: Pick<Api, "getInvite">, link: JoinLink, nowMs = Date.now()): Promise<InviteState> {
  let r: InviteRecord | null;
  try {
    r = await api.getInvite(inviteCodeHash(link.code));
  } catch (e) {
    const msg = e instanceof ApiError ? e.message : "Couldn't check the invite.";
    return { kind: "unusable", reason: "error", message: `${msg} You can still pick your own name.`, org: link.orgHint ?? null };
  }
  if (!r) return { kind: "unusable", reason: "not_found", message: "This invite link isn't valid. Pick your own name instead.", org: link.orgHint ?? null };
  const org = orgOf(r, link);
  const expired = r.status === "expired" || (r.status === "pending" && Number(r.expiresAt) * 1000 <= nowMs);
  if (expired) {
    return { kind: "unusable", reason: "expired", message: `This invite${org ? ` from ${org}` : ""} has expired. Ask for a new link, or pick your own name.`, org };
  }
  if (r.status === "claimed") {
    return { kind: "unusable", reason: "claimed", message: `This invite has already been used${r.name ? ` (${r.name})` : ""}. Pick your own name.`, org };
  }
  return { kind: "pending", code: link.code, label: r.label, org, expiresAt: Number(r.expiresAt) };
}

/** Drops the join link from the address bar once it's been used or rejected. */
export function clearJoinLink(): void {
  if (typeof window !== "undefined" && parseJoinLink(window.location.hash)) {
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }
}
