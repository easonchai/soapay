import { describe, expect, it, vi } from "vitest";
import { generateMnemonic, keysFromMnemonic } from "@soapay/sdk";
import { ApiError, type Api } from "../src/api/client.js";
import { claimName, retryableClaimError } from "../src/onboarding/actions.js";

// A claim is idempotent on the API (same registrant + same record = recovered), so transient failures
// (an API redeploy mid-claim, an issuance that timed out while its txs landed) are retried.
describe("claimName retries", () => {
  const keys = keysFromMnemonic(generateMnemonic());
  const ok = { label: "alex", name: "alex.soapay.eth" };

  it("retries a dropped connection and a failed issuance, then succeeds", async () => {
    const claim = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(0, "network", "down"))
      .mockRejectedValueOnce(new ApiError(502, "issue_failed", "on-chain name issuance failed"))
      .mockResolvedValueOnce(ok);
    const api = { claimName: claim } as unknown as Api;
    await expect(claimName({ api, keys, chainId: 84532, label: "alex", retryDelayMs: 0 })).resolves.toEqual(ok);
    expect(claim).toHaveBeenCalledTimes(3);
    // The same signed body each time.
    expect(claim.mock.calls[0]![0]).toEqual(claim.mock.calls[2]![0]);
  });

  it("does not retry a real refusal, and gives up after three attempts", async () => {
    const taken = vi.fn().mockRejectedValue(new ApiError(409, "label_taken", "taken"));
    await expect(claimName({ api: { claimName: taken } as unknown as Api, keys, chainId: 84532, label: "alex", retryDelayMs: 0 })).rejects.toThrow("taken");
    expect(taken).toHaveBeenCalledTimes(1);

    const down = vi.fn().mockRejectedValue(new ApiError(503, "unavailable", "restarting"));
    await expect(claimName({ api: { claimName: down } as unknown as Api, keys, chainId: 84532, label: "alex", retryDelayMs: 0 })).rejects.toThrow("restarting");
    expect(down).toHaveBeenCalledTimes(3);
  });

  it("classifies errors", () => {
    expect(retryableClaimError(new ApiError(504, "x", "gateway"))).toBe(true);
    expect(retryableClaimError(new ApiError(400, "bad", "bad"))).toBe(false);
    expect(retryableClaimError(new Error("boom"))).toBe(false);
  });
});
