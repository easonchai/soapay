import { useEffect, useMemo, useReducer, useRef, useState, type FormEvent, type ReactNode } from "react";
import { REGISTRY_ADDRESS, generateMnemonic, getChainConfig, validateMnemonic } from "@soapay/sdk";
import { Lockup, Steps, TopBar } from "@soapay/ui";
import { CheckCircle2, Eye, Loader2, ShieldAlert } from "lucide-react";
import { createPublicClient, http } from "viem";
import { chainName } from "../config.js";
import { demoEoaWallet, demoSmartWallet, deriveWalletKeys, injectedKeyWallet, injectedProvider, type KeyWallet } from "./walletKeys.js";
import { useServices } from "../services/ServicesProvider.js";
import { useVault } from "../vault/VaultProvider.js";
import { MIN_PASSPHRASE_LENGTH } from "../vault/crypto.js";
import { Alert, Badge, Button, Card, Checkbox, CopyButton, Field, Input, Textarea, cn, errorMessage } from "../ui/kit.js";
import { HumanCheck, sessionIdOf, sessionSignal, type HumanCheckResult } from "../worldid/index.js";
import { claimName, fullName, registerMetaAddress } from "./actions.js";
import { initialState, pickChallenge, progressOf, reduce, resumeState, words, type OnboardingState } from "./machine.js";
import { useLabelAvailability } from "./useLabelAvailability.js";
import { useInvite } from "../hooks/useInvite.js";
import { settingsOf, type KeySecret } from "../vault/types.js";
import { withInvitePayer } from "./invite.js";

/** "Invited by <org>", or why the invite can't be used. Renders nothing without an invite link. */
export function InviteBanner() {
  const { state } = useInvite();
  if (state.kind === "loading") {
    return (
      <Alert variant="info">
        <Loader2 className="mr-1 inline size-3 animate-spin" aria-hidden /> Checking your invite…
      </Alert>
    );
  }
  if (state.kind === "pending") {
    return (
      <Alert variant="success" title={state.org ? `Invited by ${state.org}` : "You've been invited"}>
        <span data-testid="invite-banner">
          Your pay name will be <span className="font-mono">{fullName(state.label)}</span>.
        </span>
      </Alert>
    );
  }
  if (state.kind === "unusable") {
    return (
      <Alert variant="warning" title="This invite can't be used">
        <span data-testid="invite-banner">{state.message}</span>
      </Alert>
    );
  }
  return null;
}

/** `claimInvite`: an existing, onboarded vault opened an invite link: go straight to the name step. */
export function Onboarding({ claimInvite = false }: { claimInvite?: boolean } = {}) {
  const vault = useVault();
  const [state, dispatch] = useReducer(reduce, undefined, (): OnboardingState =>
    claimInvite ? { step: "name" } : vault.data ? resumeState(vault.data.profile) : initialState,
  );
  const [cur, total] = progressOf(state);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const svc = useServices();

  // Move focus to the new step's heading so screen readers announce it.
  useEffect(() => {
    headingRef.current?.focus();
  }, [state.step]);

  return (
    <div className="page">
      <TopBar
        tabs={[]}
        right={
          <>
            <span className="chip">
              <span className="dot" />
              {chainName(svc.settings.chainId)}
            </span>
            {svc.mock && <Badge tone="warning">Mock</Badge>}
          </>
        }
      />
      <main className="app-main">
        <div className="onb mx-auto">
          {state.step !== "welcome" && (
            <div aria-label={`Step ${cur} of ${total}`}>
              <Steps current={STEP_OF[state.step]} labels={STEP_LABELS} />
            </div>
          )}
          <Step state={state} dispatch={dispatch} headingRef={headingRef} />
        </div>
      </main>
    </div>
  );
}

/** CK's wizard steps, mapped onto our onboarding machine's states. */
const STEP_LABELS = ["Keys", "Lock", "Register", "Name", "Recovery", "Share"];
const STEP_OF: Record<OnboardingState["step"], number> = {
  welcome: 1,
  backup: 1,
  confirm: 1,
  restore: 1,
  wallet: 1,
  passphrase: 2,
  register: 3,
  name: 4,
  recovery: 5,
  share: 6,
  done: 6,
};

export function Logo() {
  return (
    <span className="brand">
      <Lockup height={18} />
    </span>
  );
}

type StepProps = {
  state: OnboardingState;
  dispatch: (e: Parameters<typeof reduce>[1]) => void;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
};

function Frame({
  title,
  lead,
  children,
  headingRef,
  onBack,
}: {
  title: string;
  lead?: ReactNode;
  children: ReactNode;
  headingRef: StepProps["headingRef"];
  onBack?: () => void;
}) {
  return (
    <section className="stack">
      {onBack && (
        <div>
          <Button variant="ghost" size="sm" onClick={onBack}>
            ← Back
          </Button>
        </div>
      )}
      <div>
        <h1 ref={headingRef} tabIndex={-1} className="outline-none">
          {title}
        </h1>
        {lead && <p className="lead">{lead}</p>}
      </div>
      {children}
    </section>
  );
}

function Step({ state, dispatch, headingRef }: StepProps) {
  switch (state.step) {
    case "welcome":
      return (
        <Frame
          headingRef={headingRef}
          title="Get paid without broadcasting your balance"
          lead="Your employer pays a fresh address every time. Only you can find and spend those payments, from this device, with one recovery phrase."
        >
          <InviteBanner />
          <div className="actions">
            <Button size="lg" onClick={() => dispatch({ type: "CREATE", mnemonic: generateMnemonic() })}>
              Create a new account
            </Button>
            <Button size="lg" variant="outline" onClick={() => dispatch({ type: "RESTORE" })}>
              Restore from recovery phrase
            </Button>
          </div>
          <p className="hint">
            Keys are created and stored in this browser, encrypted with your passphrase. Nothing secret is ever sent anywhere. A recovery
            phrase is the default and the safest backup.
          </p>
          <hr />
          <div className="stack-sm">
            <p className="muted">
              Or derive your keys from a wallet signature instead of a phrase. Plain EOA wallets only (MetaMask, Rabby, a hardware wallet);
              recovery is signing again with the same wallet.
            </p>
            <div>
              <Button variant="ghost" onClick={() => dispatch({ type: "USE_WALLET" })} data-testid="use-wallet">
                Use a wallet signature (plain EOA wallets only)
              </Button>
            </div>
          </div>
        </Frame>
      );
    case "backup":
      return <BackupStep mnemonic={state.mnemonic} dispatch={dispatch} headingRef={headingRef} />;
    case "confirm":
      return <ConfirmStep state={state} dispatch={dispatch} headingRef={headingRef} />;
    case "restore":
      return <RestoreStep error={state.error} dispatch={dispatch} headingRef={headingRef} />;
    case "wallet":
      return <WalletStep error={state.error} dispatch={dispatch} headingRef={headingRef} />;
    case "passphrase":
      return <PassphraseStep secret={state.wallet ?? state.mnemonic} dispatch={dispatch} headingRef={headingRef} />;
    case "register":
      return <RegisterStep dispatch={dispatch} headingRef={headingRef} />;
    case "name":
      return <NameStep dispatch={dispatch} headingRef={headingRef} />;
    case "recovery":
      return <RecoveryStep label={state.label} inviteCode={state.inviteCode} dispatch={dispatch} headingRef={headingRef} />;
    case "share":
    case "done":
      return <ShareStep dispatch={dispatch} headingRef={headingRef} />;
  }
}

function BackupStep({ mnemonic, dispatch, headingRef }: { mnemonic: string } & Omit<StepProps, "state">) {
  const [revealed, setRevealed] = useState(false);
  const [saved, setSaved] = useState(false);
  const list = words(mnemonic);
  return (
    <Frame
      headingRef={headingRef}
      title="Write down your recovery phrase"
      lead="These 12 words are the only way to recover your payments. You'll see them once."
      onBack={() => dispatch({ type: "BACK" })}
    >
      <Alert variant="warning" title="Losing the seed loses the funds.">
        Nobody can reset it: not Soapay, not your employer. Write it on paper and keep it somewhere safe. Never type it into a
        website or share it.
      </Alert>
      <div className="relative">
        <ol
          aria-label="Recovery phrase"
          className={cn(
            "grid grid-cols-2 gap-2 rounded-lg border bg-card p-3 sm:grid-cols-3",
            !revealed && "pointer-events-none blur-md select-none",
          )}
          aria-hidden={!revealed}
        >
          {list.map((w, i) => (
            <li key={i} className="flex items-baseline gap-2 rounded-md bg-muted px-3 py-2 font-mono text-sm">
              <span className="w-5 text-right text-xs text-muted-foreground tabular-nums">{i + 1}</span>
              <span>{revealed ? w : "••••"}</span>
            </li>
          ))}
        </ol>
        {!revealed && (
          <div className="absolute inset-0 grid place-items-center">
            <Button variant="secondary" onClick={() => setRevealed(true)}>
              <Eye className="size-4" aria-hidden /> Reveal phrase
            </Button>
          </div>
        )}
      </div>
      <Checkbox checked={saved} onChange={setSaved} label="I wrote down all 12 words, in order" />
      <Button
        size="lg"
        className="w-full"
        disabled={!revealed || !saved}
        onClick={() => dispatch({ type: "BACKED_UP", challenge: pickChallenge(list.length, 3) })}
      >
        Continue
      </Button>
    </Frame>
  );
}

function ConfirmStep({ state, dispatch, headingRef }: { state: Extract<OnboardingState, { step: "confirm" }> } & Omit<StepProps, "state">) {
  const [answers, setAnswers] = useState(() => state.challenge.map(() => ""));
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (state.error) first.current?.focus();
  }, [state.error, state.attempts]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    dispatch({ type: "CONFIRM", answers });
  };
  return (
    <Frame
      headingRef={headingRef}
      title="Check your backup"
      lead="Enter the words at these positions from what you wrote down."
      onBack={() => dispatch({ type: "BACK" })}
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-3">
          {state.challenge.map((idx, i) => (
            <Field key={idx} label={`Word #${idx + 1}`}>
              {({ id }) => (
                <Input
                  id={id}
                  ref={i === 0 ? first : undefined}
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  aria-invalid={Boolean(state.error) || undefined}
                  value={answers[i]}
                  onChange={(e) => setAnswers((a) => a.map((v, j) => (j === i ? e.target.value : v)))}
                  className="font-mono"
                />
              )}
            </Field>
          ))}
        </div>
        {state.error && (
          <p className="text-sm font-medium text-destructive" role="alert">
            {state.error}
          </p>
        )}
        <Button type="submit" size="lg" className="w-full" disabled={answers.some((a) => !a.trim())}>
          Confirm backup
        </Button>
      </form>
    </Frame>
  );
}

function RestoreStep({ error, dispatch, headingRef }: { error: string | null } & Omit<StepProps, "state">) {
  const [phrase, setPhrase] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const m = phrase.trim().toLowerCase().split(/\s+/).join(" ");
    dispatch({ type: "RESTORE_SUBMIT", mnemonic: m, valid: validateMnemonic(m) });
  };
  return (
    <Frame
      headingRef={headingRef}
      title="Restore your account"
      lead="Enter your 12 or 24 word recovery phrase. Every payment you ever received will be found again from the chain."
      onBack={() => dispatch({ type: "BACK" })}
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Recovery phrase" error={error} hint="Words separated by spaces.">
          {({ id, describedBy, invalid }) => (
            <Textarea
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid || undefined}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              className="font-mono"
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              placeholder="apple banana …"
            />
          )}
        </Field>
        <Button type="submit" size="lg" className="w-full" disabled={!phrase.trim()}>
          Continue
        </Button>
      </form>
    </Frame>
  );
}

/**
 * The wallet-signature key option (plain EOAs only). The account's code is checked before any signature is
 * requested; then the wallet signs the Soapay message twice (it must sign identically). Mock mode offers a
 * throwaway demo EOA and a demo smart wallet (refused), so both outcomes can be clicked through.
 */
function WalletStep({ error, dispatch, headingRef }: { error: string | null } & Omit<StepProps, "state">) {
  const svc = useServices();
  const [stage, setStage] = useState<string | null>(null);
  const injected = injectedProvider();
  const payrollCode = useMemo(() => {
    if (svc.mock) return undefined;
    const client = createPublicClient({ chain: getChainConfig(svc.settings.chainId).chain, transport: http(svc.settings.rpcUrl || undefined) });
    return (address: `0x${string}`) => client.getCode({ address });
  }, [svc.mock, svc.settings.chainId, svc.settings.rpcUrl]);

  const run = async (wallet: KeyWallet) => {
    try {
      const { secret } = await deriveWalletKeys(wallet, (s) =>
        setStage(
          s === "connect"
            ? "Connecting…"
            : s === "check"
              ? "Checking this is a plain EOA…"
              : s === "sign1"
                ? "Sign the Soapay message in your wallet (1 of 2)…"
                : "Sign it once more, so we know your wallet always signs the same way (2 of 2)…",
        ),
      );
      dispatch({ type: "WALLET_SIGNED", wallet: secret });
    } catch (e) {
      dispatch({ type: "WALLET_FAILED", error: errorMessage(e).split("\n")[0] ?? "The wallet refused." });
    } finally {
      setStage(null);
    }
  };

  return (
    <Frame
      headingRef={headingRef}
      title="Create keys from a wallet signature"
      lead="Your wallet signs one fixed message. The keys come from that signature and are stored in this browser, encrypted with your passphrase. Nothing goes on-chain."
      onBack={() => dispatch({ type: "BACK" })}
    >
      <Alert variant="warning" title="Plain EOA wallets only">
        Smart-account and passkey wallets (Coinbase Smart Wallet, Safe, 7702-delegated accounts) can't derive stable keys from a signature and
        are refused. If you lose this wallet, the payments are gone: there's no phrase to fall back on.
      </Alert>
      {error && (
        <Alert variant="destructive" title="Can't use this wallet">
          <span data-testid="wallet-error">{error}</span>
        </Alert>
      )}
      <div className="actions">
        {svc.mock ? (
          <>
            <Button size="lg" onClick={() => void run(demoEoaWallet())} loading={stage !== null}>
              Sign with the demo EOA
            </Button>
            <Button variant="outline" onClick={() => void run(demoSmartWallet())} disabled={stage !== null}>
              Try a demo smart wallet
            </Button>
          </>
        ) : (
          <Button size="lg" onClick={() => injected && void run(injectedKeyWallet(injected, payrollCode))} loading={stage !== null} disabled={!injected}>
            {injected ? "Connect wallet and sign" : "No wallet extension found"}
          </Button>
        )}
        {stage && <span className="status">{stage}</span>}
      </div>
      <p className="hint">Changed your mind? Go back and create a recovery phrase instead: it's the default for a reason.</p>
    </Frame>
  );
}

function PassphraseStep({ secret, dispatch, headingRef }: { secret: KeySecret } & Omit<StepProps, "state">) {
  const vault = useVault();
  const [pass, setPass] = useState("");
  const [again, setAgain] = useState("");
  const [show, setShow] = useState(false);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tooShort = pass.length < MIN_PASSPHRASE_LENGTH;
  const mismatch = again.length > 0 && again !== pass;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (tooShort || pass !== again) return;
    setBusy(true);
    setError(null);
    try {
      await vault.create(secret, pass);
      dispatch({ type: "VAULT_CREATED" });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Frame
      headingRef={headingRef}
      title="Lock this device"
      lead="Your passphrase encrypts your keys in this browser. You'll enter it each time you open Soapay."
      onBack={() => dispatch({ type: "BACK" })}
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {/* Helps password managers attach the passphrase to this app. */}
        <input type="text" autoComplete="username" value="soapay-vault" readOnly hidden />
        <Field
          label="Passphrase"
          hint={`At least ${MIN_PASSPHRASE_LENGTH} characters. A few random words work well.`}
          error={touched && tooShort ? `Use at least ${MIN_PASSPHRASE_LENGTH} characters.` : null}
        >
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              type={show ? "text" : "password"}
              autoComplete="new-password"
              aria-describedby={describedBy}
              aria-invalid={invalid || undefined}
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              onBlur={() => pass && setTouched(true)}
            />
          )}
        </Field>
        <Field label="Repeat passphrase" error={mismatch ? "The passphrases don't match." : null}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              type={show ? "text" : "password"}
              autoComplete="new-password"
              aria-describedby={describedBy}
              aria-invalid={invalid || undefined}
              value={again}
              onChange={(e) => setAgain(e.target.value)}
            />
          )}
        </Field>
        <Checkbox checked={show} onChange={setShow} label="Show passphrase" />
        {error && <Alert variant="destructive">{error}</Alert>}
        <Button type="submit" size="lg" className="w-full" loading={busy} disabled={busy || tooShort || pass !== again}>
          {busy ? "Encrypting…" : "Encrypt and continue"}
        </Button>
        <p className="text-xs text-muted-foreground">
          {typeof secret === "string"
            ? "The passphrase only protects this device. Your recovery phrase is still the only backup."
            : "The passphrase only protects this device. Signing again with the same wallet is your backup."}
        </p>
      </form>
    </Frame>
  );
}

function RecoveryStep({ label, inviteCode, dispatch, headingRef }: { label: string; inviteCode?: `0x${string}` | undefined } & Omit<StepProps, "state">) {
  const vault = useVault();
  const invite = useInvite();
  const svc = useServices();
  const keys = vault.keys!;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** Claims the name, with the World ID session when there is one. */
  const claim = async (session: HumanCheckResult | undefined) => {
    setBusy(true);
    setError(null);
    try {
      const rec = await claimName({ api: svc.api, keys, chainId: svc.settings.chainId, label, session, inviteCode });
      const sessionId = sessionIdOf(session);
      // The inviting employer becomes a known payer (its payroll isn't "Unknown payer").
      const inv = invite.state.kind === "pending" && inviteCode && invite.state.code === inviteCode ? invite.state : null;
      await vault.update((d) => ({
        ...d,
        ...(inv ? { settings: withInvitePayer(settingsOf(d), inv) } : {}),
        profile: {
          ...d.profile,
          name: { label, name: rec.name ?? fullName(label), at: Date.now() },
          ...(sessionId
            ? { recovery: { kind: "world-id" as const, at: Date.now(), sessionId, attachedTo: label } }
            : { recoverySkipped: true }),
        },
      }));
      if (inviteCode) invite.dismiss();
      dispatch({ type: "NAMED" });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Frame
      headingRef={headingRef}
      onBack={() => dispatch({ type: "BACK" })}
      title="Enable self-service key recovery"
      lead={
        <>
          Optional. If you ever lose this device or your keys leak, a World ID Selfie Check lets you move{" "}
          <span className="font-mono">{fullName(label)}</span> to new keys without asking your employer.
        </>
      }
    >
      <HumanCheck
        mode="create-session"
        apiUrl={svc.settings.apiUrl}
        signal={sessionSignal(label, keys.registrantAddress)}
        onError={(e) => setError(errorMessage(e))}
        onResult={(r) => claim(r)}
      />
      {error && (
        <Alert variant="destructive" title="That didn't work">
          {error}
        </Alert>
      )}
      <Alert variant="info">
        Without it you can still change keys later, but your employer has to approve the change by hand before paying you again. You can
        also add World ID later from Name settings (it then needs 72 hours before it can back a key change).
      </Alert>
      <Button variant="ghost" className="w-full" onClick={() => void claim(undefined)} loading={busy}>
        Skip and claim {fullName(label)}
      </Button>
    </Frame>
  );
}

function RegisterStep({ dispatch, headingRef }: Omit<StepProps, "state">) {
  const vault = useVault();
  const svc = useServices();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keys = vault.keys!;
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await registerMetaAddress({ api: svc.api, client: svc.client, keys, chainId: svc.settings.chainId });
      await vault.update((d) => ({
        ...d,
        profile: { ...d.profile, registration: { txHash: r.txHash, status: r.status, chainId: svc.settings.chainId, at: Date.now() } },
      }));
      dispatch({ type: "REGISTERED" });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Frame
      headingRef={headingRef}
      title="Publish your payment address"
      lead="We register your stealth meta-address on the public ERC-6538 registry. It lets employers derive a fresh address for every payment. We pay the gas."
    >
      <div className="card">
        <dl className="facts">
          <dt>Registered by</dt>
          <dd>
            <code>{keys.registrantAddress}</code>
            <span className="note">A throwaway address derived from your keys. It holds no funds and your main wallet never signs.</span>
          </dd>
          <dt>Meta-address</dt>
          <dd>
            <code>{keys.metaAddressURI}</code>
          </dd>
          <dt>Registry</dt>
          <dd>
            <code>{REGISTRY_ADDRESS}</code>
          </dd>
        </dl>
      </div>
      {error && (
        <Alert variant="destructive" title="Registration didn't go through">
          {error}
        </Alert>
      )}
      <Button size="lg" className="w-full" onClick={run} loading={busy}>
        {busy ? "Signing and relaying…" : error ? "Try again" : "Register for free"}
      </Button>
    </Frame>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[8rem_1fr] sm:gap-3">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function NameStep({ dispatch, headingRef }: Omit<StepProps, "state">) {
  const vault = useVault();
  const svc = useServices();
  const keys = vault.keys!;
  const invite = useInvite().state;
  const invited = invite.kind === "pending" ? invite : null;
  const [typed, setLabel] = useState("");
  // An invite's label is reserved for us: locked, and no availability check (it looks taken to others).
  const label = invited ? invited.label : typed;
  const status = useLabelAvailability(svc.api, invited ? "" : label, keys.registrantAddress);
  const canClaim = invited !== null || status.kind === "available" || status.kind === "yours";

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!canClaim) return;
    dispatch(invited ? { type: "NAME_CHOSEN", label, inviteCode: invited.code } : { type: "NAME_CHOSEN", label });
  };
  const skip = async () => {
    await vault.update((d) => ({ ...d, profile: { ...d.profile, nameSkipped: true } }));
    dispatch({ type: "SKIP_NAME" });
  };

  const hint = useMemo(() => {
    switch (status.kind) {
      case "checking":
        return (
          <span className="inline-flex items-center gap-1">
            <Loader2 className="size-3 animate-spin" aria-hidden /> Checking…
          </span>
        );
      case "available":
        return <span className="text-success">{fullName(label)} is available.</span>;
      case "yours":
        return <span className="text-success">{fullName(label)} is already yours.</span>;
      default:
        return "Your employer pays this name. It never shows your balance or wallet.";
    }
  }, [status, label]);

  const fieldError =
    status.kind === "invalid" ? status.message : status.kind === "taken" ? "That name is taken. Try another." : status.kind === "error" ? status.message : null;

  return (
    <Frame
      headingRef={headingRef}
      title={invited ? "Your pay name" : "Pick your pay name"}
      lead={invited ? "Your employer reserved this name for you. It points to your meta-address, not to any wallet." : "Something your employer can type. It points to your meta-address, not to any wallet."}
    >
      <InviteBanner />
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Name" hint={invited ? "Set by your invite." : hint} error={invited ? null : fieldError}>
          {({ id, describedBy, invalid }) => (
            <div className="flex items-stretch">
              <Input
                id={id}
                aria-describedby={describedBy}
                aria-invalid={invalid || undefined}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                inputMode="text"
                placeholder="alex"
                value={label}
                readOnly={invited !== null}
                aria-readonly={invited !== null || undefined}
                data-testid="label-input"
                onChange={(e) => setLabel(e.target.value.toLowerCase().trim())}
                className="rounded-r-none font-mono"
                maxLength={32}
              />
              <span className="inline-flex items-center rounded-r-md border border-l-0 border-input bg-muted px-3 font-mono text-sm text-muted-foreground">
                .soapay.eth
              </span>
            </div>
          )}
        </Field>
        <Button type="submit" size="lg" className="w-full" disabled={!canClaim}>
          Continue
        </Button>
        <Button variant="ghost" className="w-full" onClick={skip}>
          Skip, I'll share my meta-address instead
        </Button>
      </form>
    </Frame>
  );
}

function ShareStep({ dispatch, headingRef }: Omit<StepProps, "state">) {
  const vault = useVault();
  const profile = vault.data!.profile;
  const value = profile.name?.name ?? vault.keys!.metaAddressURI;
  const finish = async () => {
    await vault.update((d) => ({ ...d, profile: { ...d.profile, onboardedAt: Date.now() } }));
    dispatch({ type: "FINISH" });
  };
  return (
    <Frame headingRef={headingRef} title="Share this one string with your employer" lead="That's all they need to pay you. Each payday lands at a new address only you can link.">
      <div className="share">
        <div className="label">{profile.name ? "Your pay name" : "Your meta-address"}</div>
        <div className={cn("value", profile.name && "text-2xl font-semibold")} data-testid="share-string">
          {value}
        </div>
        <CopyButton value={value} label="Copy" />
      </div>
      {profile.name && (
        <div className="card">
          <dl className="facts">
            <dt>Meta-address</dt>
            <dd>
              <code>{vault.keys!.metaAddressURI}</code>
            </dd>
            <dt>Registrant</dt>
            <dd>
              <code>{vault.keys!.registrantAddress}</code>
            </dd>
          </dl>
        </div>
      )}
      <Alert variant="info" title="Don't send them a wallet address.">
        A normal wallet address shows everyone your whole salary history. This string doesn't.
      </Alert>
      {!profile.name && (
        <Alert variant="warning">
          <ShieldAlert className="mr-1 inline size-4" aria-hidden />
          Without a name, anyone who changes this string in your employer's records could redirect your pay. Claim a name later in Name settings.
        </Alert>
      )}
      <Button size="lg" className="w-full" onClick={finish}>
        Go to my payments
      </Button>
    </Frame>
  );
}
