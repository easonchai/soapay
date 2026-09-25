import { useEffect, useMemo, useReducer, useRef, useState, type FormEvent, type ReactNode } from "react";
import { generateMnemonic, validateMnemonic } from "@soapay/sdk";
import { ArrowLeft, CheckCircle2, Eye, KeyRound, Loader2, ShieldAlert, Sparkles } from "lucide-react";
import { useServices } from "../services/ServicesProvider.js";
import { useVault } from "../vault/VaultProvider.js";
import { MIN_PASSPHRASE_LENGTH } from "../vault/crypto.js";
import { Alert, Button, Card, Checkbox, CopyButton, Field, Input, Textarea, cn, errorMessage } from "../ui/kit.js";
import { HumanVerification } from "./HumanVerification.js";
import { claimName, fullName, registerMetaAddress } from "./actions.js";
import { initialState, pickChallenge, progressOf, reduce, resumeState, words, type OnboardingState } from "./machine.js";
import { useLabelAvailability } from "./useLabelAvailability.js";

export function Onboarding() {
  const vault = useVault();
  const [state, dispatch] = useReducer(reduce, undefined, (): OnboardingState =>
    vault.data ? resumeState(vault.data.profile) : initialState,
  );
  const [cur, total] = progressOf(state);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Move focus to the new step's heading so screen readers announce it.
  useEffect(() => {
    headingRef.current?.focus();
  }, [state.step]);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col px-4 py-8 sm:py-14">
      <div className="mb-8 flex items-center justify-between gap-4">
        <Logo />
        {state.step !== "welcome" && (
          <div className="flex items-center gap-3" aria-label={`Step ${cur} of ${total}`}>
            <span className="text-xs text-muted-foreground tabular-nums">
              {cur}/{total}
            </span>
            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted" aria-hidden>
              <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${(cur / total) * 100}%` }} />
            </div>
          </div>
        )}
      </div>
      <Step state={state} dispatch={dispatch} headingRef={headingRef} />
    </div>
  );
}

export function Logo() {
  return (
    <div className="flex items-center gap-2 font-semibold tracking-tight">
      <span className="grid size-7 place-items-center rounded-md bg-primary text-sm text-primary-foreground" aria-hidden>
        S
      </span>
      Soapay
    </div>
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
    <main className="space-y-6">
      {onBack && (
        <Button variant="ghost" size="sm" onClick={onBack} className="-ml-3">
          <ArrowLeft className="size-4" aria-hidden /> Back
        </Button>
      )}
      <div className="space-y-2">
        <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-semibold tracking-tight outline-none sm:text-3xl">
          {title}
        </h1>
        {lead && <p className="text-muted-foreground">{lead}</p>}
      </div>
      {children}
    </main>
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
          <div className="grid gap-3">
            <Button size="lg" onClick={() => dispatch({ type: "CREATE", mnemonic: generateMnemonic() })}>
              <Sparkles className="size-4" aria-hidden /> Create a new account
            </Button>
            <Button size="lg" variant="outline" onClick={() => dispatch({ type: "RESTORE" })}>
              <KeyRound className="size-4" aria-hidden /> Restore from recovery phrase
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Keys are created and stored in this browser, encrypted with your passphrase. Nothing secret is ever sent anywhere.
          </p>
        </Frame>
      );
    case "backup":
      return <BackupStep mnemonic={state.mnemonic} dispatch={dispatch} headingRef={headingRef} />;
    case "confirm":
      return <ConfirmStep state={state} dispatch={dispatch} headingRef={headingRef} />;
    case "restore":
      return <RestoreStep error={state.error} dispatch={dispatch} headingRef={headingRef} />;
    case "passphrase":
      return <PassphraseStep mnemonic={state.mnemonic} dispatch={dispatch} headingRef={headingRef} />;
    case "human":
      return <HumanStep dispatch={dispatch} headingRef={headingRef} />;
    case "register":
      return <RegisterStep proof={state.proof} dispatch={dispatch} headingRef={headingRef} />;
    case "name":
      return <NameStep proof={state.proof} dispatch={dispatch} headingRef={headingRef} />;
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

function PassphraseStep({ mnemonic, dispatch, headingRef }: { mnemonic: string } & Omit<StepProps, "state">) {
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
      await vault.create(mnemonic, pass);
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
          The passphrase only protects this device. Your recovery phrase is still the only backup.
        </p>
      </form>
    </Frame>
  );
}

function HumanStep({ dispatch, headingRef }: Omit<StepProps, "state">) {
  const vault = useVault();
  const [busy, setBusy] = useState(false);
  const signal = vault.keys?.registrantAddress ?? "";
  return (
    <Frame headingRef={headingRef} title="One person, one account" lead="A quick uniqueness check before we pay your registration gas.">
      <HumanVerification
        action="soapay-enroll"
        signal={signal}
        busy={busy}
        onVerified={async (proof) => {
          setBusy(true);
          try {
            await vault.update((d) => ({
              ...d,
              profile: { ...d.profile, human: { kind: proof === undefined ? "placeholder" : "world-id", at: Date.now() } },
            }));
            dispatch({ type: "HUMAN_VERIFIED", proof });
          } finally {
            setBusy(false);
          }
        }}
      />
    </Frame>
  );
}

function RegisterStep({ proof, dispatch, headingRef }: { proof: unknown } & Omit<StepProps, "state">) {
  const vault = useVault();
  const svc = useServices();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keys = vault.keys!;
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await registerMetaAddress({ api: svc.api, client: svc.client, keys, chainId: svc.settings.chainId, proof });
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
      <Card className="space-y-3 p-4">
        <Row label="Registered by">
          <span className="font-mono text-xs break-all">{keys.registrantAddress}</span>
        </Row>
        <p className="text-xs text-muted-foreground">
          A throwaway address derived from your phrase. It holds no funds and your main wallet never signs.
        </p>
        <Row label="Meta-address">
          <span className="font-mono text-xs break-all">{keys.metaAddressURI}</span>
        </Row>
      </Card>
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

function NameStep({ proof, dispatch, headingRef }: { proof: unknown } & Omit<StepProps, "state">) {
  const vault = useVault();
  const svc = useServices();
  const keys = vault.keys!;
  const [label, setLabel] = useState("");
  const status = useLabelAvailability(svc.api, label, keys.registrantAddress);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canClaim = status.kind === "available" || status.kind === "yours";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canClaim) return;
    setBusy(true);
    setError(null);
    try {
      const rec = await claimName({ api: svc.api, keys, chainId: svc.settings.chainId, label, proof });
      await vault.update((d) => ({ ...d, profile: { ...d.profile, name: { label, name: rec.name ?? fullName(label), at: Date.now() } } }));
      dispatch({ type: "NAMED" });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
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
    <Frame headingRef={headingRef} title="Pick your pay name" lead="Something your employer can type. It points to your meta-address, not to any wallet.">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Name" hint={hint} error={fieldError}>
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
        {error && <Alert variant="destructive">{error}</Alert>}
        <Button type="submit" size="lg" className="w-full" disabled={!canClaim} loading={busy}>
          Claim name
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
      <Card className="space-y-4 p-5 text-center">
        <CheckCircle2 className="mx-auto size-8 text-success" aria-hidden />
        <p className={cn("font-mono break-all", profile.name ? "text-2xl font-semibold" : "text-sm")} data-testid="share-string">
          {value}
        </p>
        <CopyButton value={value} label="Copy" className="mx-auto" />
      </Card>
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
