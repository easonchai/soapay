import { useEffect, useMemo, useReducer, useRef, useState, type FormEvent, type ReactNode } from "react";
import { REGISTRY_ADDRESS, generateMnemonic, getChainConfig, validateMnemonic } from "@soapay/sdk";
import { Lockup, Steps, TopBar } from "@soapay/ui";
import { CheckCircle2, Download, Eye, FileText, Loader2, ShieldAlert } from "lucide-react";
import { createPublicClient, http } from "viem";
import { chainName } from "../config.js";
import { demoEoaWallet, demoSmartWallet, deriveWalletKeys, injectedKeyWallet, injectedProvider, type KeyWallet } from "./walletKeys.js";
import { useServices } from "../services/ServicesProvider.js";
import { useVault } from "../vault/VaultProvider.js";
import { MIN_PASSPHRASE_LENGTH } from "../vault/crypto.js";
import { PasskeyUnsupportedError } from "../vault/passkey.js";
import { Alert, Badge, Button, Card, Checkbox, CopyButton, Field, Input, Textarea, cn, errorMessage } from "../ui/kit.js";
import { HumanCheck, sessionIdOf, sessionSignal, type HumanCheckResult } from "../worldid/index.js";
import { claimName, fullName, registerMetaAddress } from "./actions.js";
import { initialState, progressOf, reduce, resumeState, words, type OnboardingState } from "./machine.js";
import { downloadText, parseRecoveryKit, readFileText, recoveryKitFilename, recoveryKitText } from "./recoveryKit.js";
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
          lead="You get one private key. Your employer pays a fresh address every time; only you can open them."
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
            Your keys are created in this browser and stay encrypted here; you unlock them with a passkey (or a passphrase). Nothing secret is
            ever sent anywhere.
          </p>
        </Frame>
      );
    case "backup":
      return <RecoveryKitStep mnemonic={state.mnemonic} saved={state.saved ?? false} dispatch={dispatch} headingRef={headingRef} />;
    case "restore":
      return <RestoreStep error={state.error} dispatch={dispatch} headingRef={headingRef} />;
    case "wallet":
      return <WalletStep error={state.error} dispatch={dispatch} headingRef={headingRef} />;
    case "passphrase":
      return <LockStep secret={state.wallet ?? state.mnemonic} dispatch={dispatch} headingRef={headingRef} />;
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

/**
 * D-44, "save, don't memorise": the Keys step asks the user to SAVE a recovery kit (download a small text
 * file, copy the phrase into a password manager, or show the words for paper), not to memorise the words or
 * pass a quiz. The phrase is shown on this screen only; coming back from the Lock step doesn't show it again.
 */
function RecoveryKitStep({ mnemonic, saved, dispatch, headingRef }: { mnemonic: string; saved: boolean } & Omit<StepProps, "state">) {
  const invite = useInvite().state;
  const name = invite.kind === "pending" ? fullName(invite.label) : undefined;
  const [createdAt] = useState(() => new Date());
  const [revealed, setRevealed] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const list = words(mnemonic);

  if (saved) {
    return (
      <Frame
        headingRef={headingRef}
        title="Recovery kit saved"
        lead="You already saved the recovery kit for these keys. It isn't shown again."
        onBack={() => dispatch({ type: "BACK" })}
      >
        <Alert variant="info">
          Continue to lock this device. If you didn't keep the kit, go back and start again: that makes new keys and a new kit.
        </Alert>
        <Button size="lg" className="w-full" onClick={() => dispatch({ type: "BACKED_UP" })}>
          Continue
        </Button>
      </Frame>
    );
  }

  const acted = downloaded || copied || revealed;
  const filename = recoveryKitFilename(name, createdAt);
  const download = () => {
    downloadText(filename, recoveryKitText({ mnemonic, name, createdAt }));
    setDownloaded(true);
  };

  return (
    <Frame
      headingRef={headingRef}
      title="Save your recovery kit"
      lead="Your recovery phrase is the one key to every payment you'll get, even if Soapay disappears. You don't need to remember it: just save it somewhere safe."
      onBack={() => dispatch({ type: "BACK" })}
    >
      <Alert variant="warning" title="Losing the seed loses the funds.">
        Save the kit in your password manager, iCloud Keychain or Google Password Manager notes, or a file you keep. Day to day you unlock
        with a passkey, so you only need the kit on a new device or if this one is lost. Nobody can reset it: not Soapay, not your
        employer. Never share it.
      </Alert>
      <div className="actions">
        <Button size="lg" onClick={download} data-testid="download-kit">
          <Download className="size-4" aria-hidden /> Download recovery kit
        </Button>
        <CopyButton value={mnemonic} label="Copy phrase" onCopied={() => setCopied(true)} />
        {!revealed && (
          <Button variant="outline" onClick={() => setRevealed(true)}>
            <Eye className="size-4" aria-hidden /> Show words
          </Button>
        )}
      </div>
      {downloaded && (
        <p className="hint" data-testid="kit-downloaded">
          <CheckCircle2 className="mr-1 inline size-4" aria-hidden /> Downloaded {filename}. Move it somewhere safe.
        </p>
      )}
      {copied && (
        <p className="hint" data-testid="kit-copied">
          Copied. Paste it into a password manager note, then clear your clipboard (copy something else).
        </p>
      )}
      {revealed && (
        <ol aria-label="Recovery phrase" className="grid grid-cols-2 gap-2 rounded-lg border bg-card p-3 sm:grid-cols-3">
          {list.map((w, i) => (
            <li key={i} className="flex items-baseline gap-2 rounded-md bg-muted px-3 py-2 font-mono text-sm">
              <span className="w-5 text-right text-xs text-muted-foreground tabular-nums">{i + 1}</span>
              <span>{w}</span>
            </li>
          ))}
        </ol>
      )}
      <Checkbox checked={confirmed} onChange={setConfirmed} label="I saved my recovery kit somewhere safe" />
      <Button size="lg" className="w-full" disabled={!acted || !confirmed} onClick={() => dispatch({ type: "BACKED_UP" })}>
        Continue
      </Button>
      {!acted && <p className="text-xs text-muted-foreground">Download, copy or show your recovery kit first.</p>}
    </Frame>
  );
}

function RestoreStep({ error, dispatch, headingRef }: { error: string | null } & Omit<StepProps, "state">) {
  const [phrase, setPhrase] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const m = phrase.trim().toLowerCase().split(/\s+/).join(" ");
    dispatch({ type: "RESTORE_SUBMIT", mnemonic: m, valid: validateMnemonic(m) });
  };
  const openKit = async (file: File | undefined) => {
    setFileError(null);
    if (!file) return;
    try {
      const m = parseRecoveryKit(await readFileText(file));
      if (!m) {
        setFileError("That file doesn't contain a valid recovery phrase. Open your Soapay recovery kit, or paste the words.");
        return;
      }
      dispatch({ type: "RESTORE_SUBMIT", mnemonic: m, valid: true });
    } catch (err) {
      setFileError(errorMessage(err));
    } finally {
      if (fileInput.current) fileInput.current.value = "";
    }
  };
  return (
    <Frame
      headingRef={headingRef}
      title="Restore your account"
      lead="Open your recovery kit, or enter your 12 or 24 word recovery phrase. Every payment you ever received will be found again from the chain."
      onBack={() => dispatch({ type: "BACK" })}
    >
      <div className="stack-sm">
        <input
          ref={fileInput}
          type="file"
          accept=".txt,text/plain"
          className="sr-only"
          tabIndex={-1}
          aria-label="Recovery kit file"
          data-testid="kit-file"
          onChange={(e) => void openKit(e.target.files?.[0])}
        />
        <Button variant="outline" size="lg" className="w-full" onClick={() => fileInput.current?.click()}>
          <FileText className="size-4" aria-hidden /> Open recovery kit
        </Button>
        {fileError && (
          <p className="text-sm font-medium text-destructive" role="alert" data-testid="kit-file-error">
            {fileError}
          </p>
        )}
      </div>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Recovery phrase" error={error} hint="Or paste the words, separated by spaces.">
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
      <div className="text-center">
        <button type="button" className="btn-text text-xs" onClick={() => dispatch({ type: "USE_WALLET" })} data-testid="use-wallet">
          Made your account with a wallet signature?
        </button>
      </div>
    </Frame>
  );
}

/**
 * Recovering an account made from a wallet signature before D-45 (plain EOAs only; reachable from the Restore
 * step only). The account's code is checked before any signature is requested; then the wallet signs the
 * Soapay message twice (it must sign identically). Mock mode offers a throwaway demo EOA and a demo smart
 * wallet (refused), so both outcomes can be clicked through.
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
      title="Restore from a wallet signature"
      lead="For accounts made with a wallet signature. Your wallet signs the same fixed message again; the keys come from that signature and are stored in this browser, encrypted. Nothing goes on-chain."
      onBack={() => dispatch({ type: "BACK" })}
    >
      <Alert variant="warning" title="Plain EOA wallets only">
        Use the same wallet you made the account with. Smart-account and passkey wallets (Coinbase Smart Wallet, Safe, 7702-delegated
        accounts) can't derive stable keys from a signature and are refused.
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
      <p className="hint">New accounts use a recovery kit instead. Once you're in, Name settings can move this account to a recovery phrase.</p>
    </Frame>
  );
}

const backupNote = (secret: KeySecret, lock: "passkey" | "passphrase") =>
  typeof secret === "string"
    ? `The ${lock} only protects this device. Your recovery kit is still the only backup.`
    : `The ${lock} only protects this device. Signing again with the same wallet is your backup.`;

/**
 * CK's "Lock" step (D-35): a passkey (WebAuthn PRF) by default, the passphrase as the fallback when the
 * browser has no passkey/PRF support or the user prefers it.
 */
function LockStep({ secret, dispatch, headingRef }: { secret: KeySecret } & Omit<StepProps, "state">) {
  const vault = useVault();
  const svc = useServices();
  const [mode, setMode] = useState<"checking" | "passkey" | "passphrase">("checking");
  const [canPasskey, setCanPasskey] = useState(false);
  const [fallback, setFallback] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { passkeyAvailable } = vault;

  useEffect(() => {
    let cancelled = false;
    void passkeyAvailable().then((ok) => {
      if (cancelled) return;
      setCanPasskey(ok);
      setMode(ok ? "passkey" : "passphrase");
      if (!ok) setFallback("This browser can't use a passkey here, so set a passphrase instead.");
    });
    return () => {
      cancelled = true;
    };
  }, [passkeyAvailable]);

  if (mode === "passphrase") {
    return (
      <PassphraseStep
        secret={secret}
        dispatch={dispatch}
        headingRef={headingRef}
        notice={fallback}
        onUsePasskey={
          canPasskey
            ? () => {
                setError(null);
                setMode("passkey");
              }
            : undefined
        }
      />
    );
  }

  const invite = useInvite().state;
  // Name the passkey after the pay name when an invite already reserved one, so it's recognisable later.
  const account = invite.kind === "pending" ? fullName(invite.label) : undefined;
  const usePasskey = async () => {
    setBusy(true);
    setError(null);
    try {
      await vault.createWithPasskey(secret, account);
      dispatch({ type: "VAULT_CREATED" });
    } catch (err) {
      if (err instanceof PasskeyUnsupportedError) {
        setCanPasskey(false);
        setFallback(`${err.message} Set a passphrase instead.`);
        setMode("passphrase");
      } else {
        setError(errorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Frame
      headingRef={headingRef}
      title="Lock this device"
      lead="Unlock Soapay with Face ID, your fingerprint or your device PIN. Your keys stay encrypted in this browser."
      onBack={() => dispatch({ type: "BACK" })}
    >
      {error && <Alert variant="destructive">{error}</Alert>}
      <Alert variant="info" title="Your device will ask to save a passkey">
        <span data-testid="passkey-explainer">
          Confirm with Touch ID, Face ID or your device PIN (some browsers call it "unlock device"
          {svc.mock ? "" : ", and a few ask twice"}). It's saved as <span className="font-mono">{account ?? "Soapay account"}</span> in your
          password manager. From then on, opening Soapay asks for it.
        </span>
      </Alert>
      <Button size="lg" className="w-full" loading={busy || mode === "checking"} disabled={busy || mode === "checking"} onClick={() => void usePasskey()} data-testid="use-passkey">
        {busy ? "Waiting for your passkey…" : "Use Face ID / fingerprint (passkey)"}
      </Button>
      <div className="text-center">
        <button type="button" className="btn-text" onClick={() => setMode("passphrase")} disabled={busy} data-testid="use-passphrase">
          Use a passphrase instead
        </button>
      </div>
      <p className="text-xs text-muted-foreground">
        {backupNote(secret, "passkey")}
        {svc.mock && " Mock mode: the passkey is simulated, with no real prompt."}
      </p>
    </Frame>
  );
}

function PassphraseStep({
  secret,
  dispatch,
  headingRef,
  notice,
  onUsePasskey,
}: { secret: KeySecret; notice?: string | null; onUsePasskey?: (() => void) | undefined } & Omit<StepProps, "state">) {
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
      {notice && (
        <Alert variant="info">
          <span data-testid="passkey-fallback">{notice}</span>
        </Alert>
      )}
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
        {onUsePasskey && (
          <div className="text-center">
            <button type="button" className="btn-text" onClick={onUsePasskey} disabled={busy}>
              Use a passkey instead
            </button>
          </div>
        )}
        <p className="text-xs text-muted-foreground">{backupNote(secret, "passphrase")}</p>
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
          Optional. If you ever lose this device or your keys leak, a World ID Proof of Human lets you move{" "}
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
  const passkeySaved = vault.lockKind === "passkey";
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
      {passkeySaved && (
        <Alert variant="success" title="Passkey saved on this device">
          <span data-testid="passkey-saved">Next time you open Soapay (or after it locks), it asks for this passkey to unlock.</span>
        </Alert>
      )}
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

/**
 * Claim a pay name after onboarding skipped it (Name settings). The same Name → Recovery steps as onboarding;
 * once the name is claimed the vault has `profile.name`, so the parent renders the name settings instead.
 */
export function ClaimNameLater() {
  const [state, dispatch] = useReducer(reduce, { step: "name" } as OnboardingState);
  const headingRef = useRef<HTMLHeadingElement>(null);
  switch (state.step) {
    case "name":
      return <NameStep dispatch={dispatch} headingRef={headingRef} later />;
    case "recovery":
      return <RecoveryStep label={state.label} inviteCode={state.inviteCode} dispatch={dispatch} headingRef={headingRef} />;
    default:
      return null;
  }
}

/** `later`: claiming from Name settings after skipping during onboarding, so no skip option. */
function NameStep({ dispatch, headingRef, later = false }: { later?: boolean } & Omit<StepProps, "state">) {
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
        {!later && (
          <Button variant="ghost" className="w-full" onClick={skip}>
            Skip, I'll share my meta-address instead
          </Button>
        )}
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
