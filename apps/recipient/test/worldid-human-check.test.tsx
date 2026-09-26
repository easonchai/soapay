// The real @soapay/worldid-react <HumanCheck> (D-59): World ID session requests built with IDKit
// core and shown as an inline QR, with IDKit itself mocked (no World App in tests).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const idkit = vi.hoisted(() => {
  const state = {
    calls: [] as { kind: "createSession" | "proveSession"; sessionId?: string; config: Record<string, unknown>; constraints?: unknown }[],
    /** null: World App never answers. */
    outcome: { success: true, result: { session_id: "session_ab", protocol_version: "4.0" } } as
      | null
      | { success: true; result: Record<string, unknown> }
      | { success: false; error: string },
  };
  const builder = (kind: "createSession" | "proveSession", config: Record<string, unknown>, sessionId?: string) => {
    const call: (typeof state.calls)[number] = { kind, config, ...(sessionId ? { sessionId } : {}) };
    state.calls.push(call);
    return {
      constraints: async (c: unknown) => {
        call.constraints = c;
        return {
          connectorURI: "https://world.org/verify?t=wld&i=test",
          pollUntilCompletion: () => (state.outcome ? Promise.resolve(state.outcome) : new Promise(() => undefined)),
          getDebugReport: () => ({ request: kind, response: "raw" }),
        };
      },
      preset: async () => {
        throw new Error("IDKit 4.3 rejects presets for session requests");
      },
    };
  };
  return {
    state,
    module: {
      IDKit: {
        createSession: (config: Record<string, unknown>) => builder("createSession", config),
        proveSession: (sessionId: string, config: Record<string, unknown>) => builder("proveSession", config, sessionId),
        request: () => {
          throw new Error("one-time requests are not used (D-59)");
        },
      },
      CredentialRequest: (type: string, options?: Record<string, unknown>) => ({ type, ...(options ?? {}) }),
      IDKitErrorCodes: { UserRejected: "user_rejected", Cancelled: "cancelled" },
      setDebug: () => undefined,
    },
  };
});

// @worldcoin/idkit-core is a dependency of @soapay/worldid-react only, so it is mocked by its
// resolved path (update the version here when IDKit is bumped). The real qrcode draws the QR.
vi.mock("../../../node_modules/.pnpm/@worldcoin+idkit-core@4.3.0/node_modules/@worldcoin/idkit-core/dist/index.js", () => idkit.module);

const { HumanCheck } = await import("@soapay/worldid-react");

const RP = {
  rp_context: { rp_id: "rp_test", nonce: "0x01", created_at: 1, expires_at: 301, signature: "0x02" },
  app_id: "app_test",
  environment: "production",
  kind: "session",
};

function apiFetch() {
  const bodies: unknown[] = [];
  const f = vi.fn(async (_url: string, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify(RP), { status: 200 });
  }) as unknown as typeof fetch;
  return { f, bodies };
}

beforeEach(() => {
  idkit.state.calls.length = 0;
  idkit.state.outcome = { success: true, result: { session_id: "session_ab", protocol_version: "4.0" } };
});

describe("HumanCheck (World ID session, inline QR)", () => {
  it("create-session: IDKit.createSession with Proof of Human constraints, no signal, the QR inline, the result forwarded", async () => {
    const { f, bodies } = apiFetch();
    const onResult = vi.fn();
    idkit.state.outcome = null; // World App never answers, so the panel stays open
    render(<HumanCheck mode="create-session" apiUrl="https://api.test" signal="soapay:session:alice:0x1" onResult={onResult} fetch={f} />);
    await userEvent.click(screen.getByRole("button", { name: /Protect with World ID/ }));
    expect(await screen.findByAltText("World ID QR code")).toBeTruthy();
    expect(screen.getByTestId("worldid-open-app").textContent).toBe("On this phone? Open the World ID app");
    expect(bodies).toEqual([{ kind: "session", bind: "soapay:session:alice:0x1" }]);
    expect(idkit.state.calls).toHaveLength(1);
    const call = idkit.state.calls[0]!;
    expect(call.kind).toBe("createSession");
    expect(call.config).toEqual({ app_id: "app_test", rp_context: RP.rp_context, environment: "production" });
    expect(call.constraints).toEqual({ type: "proof_of_human" }); // no signal, no preset
  });

  it("create-session forwards a successful result unchanged", async () => {
    const { f } = apiFetch();
    const onResult = vi.fn();
    render(<HumanCheck mode="create-session" apiUrl="https://api.test" signal="s" onResult={onResult} fetch={f} />);
    await userEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith({ session_id: "session_ab", protocol_version: "4.0" }));
  });

  it("rotate: IDKit.proveSession with the saved session id", async () => {
    const { f } = apiFetch();
    const onResult = vi.fn();
    render(<HumanCheck mode="rotate" apiUrl="https://api.test" sessionId="session_ab" signal="soapay:rotate:alice" onResult={onResult} fetch={f} />);
    await userEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(onResult).toHaveBeenCalled());
    expect(idkit.state.calls[0]).toMatchObject({ kind: "proveSession", sessionId: "session_ab", constraints: { type: "proof_of_human" } });
  });

  it("rotate without a session id fails before asking the API", async () => {
    const { f } = apiFetch();
    const onError = vi.fn();
    render(<HumanCheck mode="rotate" apiUrl="https://api.test" signal="s" onResult={vi.fn()} onError={onError} fetch={f} />);
    await userEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect(onError.mock.calls[0]![0].code).toBe("no_session");
    expect(f).not.toHaveBeenCalled();
    expect(idkit.state.calls).toHaveLength(0);
  });

  it("a World App error shows the debug report with Copy details, reported on close; a decline is a cancel", async () => {
    const { f } = apiFetch();
    const onError = vi.fn();
    const onCancel = vi.fn();
    idkit.state.outcome = { success: false, error: "verification_rejected" };
    render(<HumanCheck mode="create-session" apiUrl="https://api.test" signal="s" onResult={vi.fn()} onError={onError} onCancel={onCancel} fetch={f} />);
    await userEvent.click(screen.getByRole("button"));
    const debug = (await screen.findByTestId("worldid-debug")) as HTMLTextAreaElement;
    expect(debug.value).toContain("error: verification_rejected");
    expect(debug.value).toContain('"request": "createSession"');
    expect(screen.getByRole("button", { name: "Copy details" })).toBeTruthy();
    expect(onError).not.toHaveBeenCalled();
    await userEvent.click(screen.getByTestId("worldid-cancel"));
    expect(onError.mock.calls[0]![0].code).toBe("verification_rejected");

    idkit.state.outcome = { success: false, error: "user_rejected" };
    await userEvent.click(screen.getByRole("button", { name: /Protect with World ID/ }));
    await waitFor(() => expect(onCancel).toHaveBeenCalled());
  });
});
