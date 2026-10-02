import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import { Icon, Spinner } from "./ui";

const CODE_LENGTH = 6;
const MIN_PASSWORD = 8;

function Field({ label, children, hint }) {
  return (
    <label className="flex flex-col gap-1.5 text-left">
      <span className="text-sm font-medium text-ink-2">{label}</span>
      {children}
      {hint && <span className="text-xs text-ink-3">{hint}</span>}
    </label>
  );
}

function PasswordInput({ value, onChange, autoComplete, autoFocus, placeholder }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <input
        type={shown ? "text" : "password"}
        className="input w-full pr-11"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        placeholder={placeholder}
        required
      />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        className="absolute right-1.5 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full flex items-center justify-center text-ink-3 hover:bg-panel-2"
        aria-label={shown ? "Hide password" : "Show password"}
      >
        <Icon name={shown ? "visibility_off" : "visibility"} size={18} />
      </button>
    </div>
  );
}

/**
 * Six single-digit boxes; typing advances, Backspace goes back, pasting fills all.
 * `value` is a 6-character string with spaces for empty boxes.
 */
const isFullCode = (value) => new RegExp(`^\\d{${CODE_LENGTH}}$`).test(value);

function CodeInput({ value, onChange, onComplete, disabled }) {
  const refs = useRef([]);
  const digits = value.padEnd(CODE_LENGTH, " ").slice(0, CODE_LENGTH).split("");

  const setAt = (index, digit) => {
    const next = digits.slice();
    next[index] = digit || " ";
    const joined = next.join("");
    onChange(joined);
    if (isFullCode(joined)) onComplete?.(joined);
  };

  return (
    <div className="flex justify-center gap-2" onPaste={(e) => {
      const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, CODE_LENGTH);
      if (!pasted) return;
      e.preventDefault();
      onChange(pasted);
      refs.current[Math.min(pasted.length, CODE_LENGTH - 1)]?.focus();
      if (pasted.length === CODE_LENGTH) onComplete?.(pasted);
    }}>
      {digits.map((digit, i) => (
        <input
          key={i}
          ref={(el) => (refs.current[i] = el)}
          value={digit.trim()}
          disabled={disabled}
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          maxLength={1}
          autoFocus={i === 0}
          aria-label={`Digit ${i + 1}`}
          onChange={(e) => {
            const d = e.target.value.replace(/\D/g, "").slice(-1);
            if (!d) return;
            setAt(i, d);
            refs.current[i + 1]?.focus();
          }}
          onKeyDown={(e) => {
            if (e.key === "Backspace") {
              e.preventDefault();
              if (digits[i].trim()) setAt(i, "");
              else if (i > 0) {
                refs.current[i - 1]?.focus();
                setAt(i - 1, "");
              }
            }
            if (e.key === "ArrowLeft") refs.current[i - 1]?.focus();
            if (e.key === "ArrowRight") refs.current[i + 1]?.focus();
          }}
          className="w-11 h-12 sm:w-12 sm:h-14 rounded-xl border border-line bg-panel text-center text-xl font-semibold text-ink focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/40 disabled:opacity-50"
        />
      ))}
    </div>
  );
}

function PasswordChecklist({ password, confirm }) {
  const rules = [
    [`At least ${MIN_PASSWORD} characters`, password.length >= MIN_PASSWORD],
    ["Letters and numbers", /[A-Za-z]/.test(password) && /\d/.test(password)],
    ["Passwords match", Boolean(password) && password === confirm],
  ];
  return (
    <ul className="flex flex-col gap-1 text-xs">
      {rules.map(([label, ok]) => (
        <li key={label} className={`flex items-center gap-1.5 ${ok ? "text-success" : "text-ink-3"}`}>
          <Icon name={ok ? "check_circle" : "radio_button_unchecked"} size={14} />
          {label}
        </li>
      ))}
    </ul>
  );
}

function ErrorText({ message }) {
  if (!message) return null;
  return (
    <p role="alert" className="flex items-start gap-1.5 text-sm text-danger text-left">
      <Icon name="error" size={16} className="mt-0.5 shrink-0" />
      <span>{message}</span>
    </p>
  );
}

const TextLink = ({ children, onClick }) => (
  <button type="button" onClick={onClick} className="text-accent font-medium hover:underline">
    {children}
  </button>
);

/**
 * Email sign-in, plus the email-verified sign-up and password-reset flows:
 *   email → 6-digit code from the inbox → set a password → signed in.
 */
export default function EmailAuth() {
  const { setUser } = useAuth();
  const [view, setView] = useState("signin"); // signin | signup | reset
  const [step, setStep] = useState("email"); // email | code | password (signup/reset only)
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const go = (nextView) => {
    setView(nextView);
    setStep("email");
    setPassword("");
    setConfirm("");
    setCode("");
    setError(null);
    setNotice(null);
  };

  const run = async (fn) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const signIn = (e) => {
    e.preventDefault();
    run(async () => setUser(await api.login(email, password)));
  };

  const sendCode = (e) => {
    e?.preventDefault();
    run(async () => {
      const result = await api.emailStart(email, view);
      setEmail(result.email);
      setCode("");
      setStep("code");
      setResendIn(result.resendInSeconds);
      setNotice(`We sent a 6-digit code to ${result.email}. It expires in ${result.expiresInMinutes} minutes.`);
    });
  };

  const verify = (value = code) =>
    run(async () => {
      await api.emailVerify(email, view, value);
      setNotice(null);
      setStep("password");
    });

  const finish = (e) => {
    e.preventDefault();
    if (password !== confirm) return setError("Passwords don't match.");
    run(async () => setUser(await api.emailComplete(password, view === "signup" ? name : undefined)));
  };

  const title = { signin: "Sign in with email", signup: "Create your account", reset: "Reset your password" }[view];

  return (
    <div className="flex flex-col gap-4">
      <div className="text-left">
        <h2 className="font-display text-lg font-semibold">{title}</h2>
        {view !== "signin" && (
          <ol className="mt-2 flex items-center gap-2 text-xs text-ink-3" aria-label="Progress">
            {["Email", "Verify", "Password"].map((label, i) => {
              const current = ["email", "code", "password"].indexOf(step);
              return (
                <li key={label} className={`flex items-center gap-1.5 ${i <= current ? "text-accent font-medium" : ""}`}>
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] ${i <= current ? "bg-accent text-accent-fg" : "bg-panel-3"}`}>
                    {i < current ? <Icon name="check" size={13} /> : i + 1}
                  </span>
                  {label}
                  {i < 2 && <span className="w-4 h-px bg-line" />}
                </li>
              );
            })}
          </ol>
        )}
      </div>

      {view === "signin" && (
        <form onSubmit={signIn} className="flex flex-col gap-3">
          <Field label="Email">
            <input type="email" className="input w-full" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
          </Field>
          <Field label="Password">
            <PasswordInput value={password} onChange={setPassword} autoComplete="current-password" />
          </Field>
          <div className="flex justify-end -mt-1">
            <TextLink onClick={() => go("reset")}>Forgot password?</TextLink>
          </div>
          <ErrorText message={error} />
          <button type="submit" className="btn-primary h-11" disabled={busy}>
            {busy && <Spinner />} Sign in
          </button>
          <p className="text-sm text-ink-2 text-center">
            New to Ask AI? <TextLink onClick={() => go("signup")}>Create an account</TextLink>
          </p>
        </form>
      )}

      {view !== "signin" && step === "email" && (
        <form onSubmit={sendCode} className="flex flex-col gap-3">
          <Field label="Email" hint="We'll email you a 6-digit code to confirm it's yours.">
            <input type="email" className="input w-full" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" autoFocus required />
          </Field>
          <ErrorText message={error} />
          <button type="submit" className="btn-primary h-11" disabled={busy}>
            {busy && <Spinner />} Send code
          </button>
        </form>
      )}

      {view !== "signin" && step === "code" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            verify();
          }}
          className="flex flex-col gap-4"
        >
          {notice && <p className="text-sm text-ink-2 text-left">{notice}</p>}
          <CodeInput value={code} onChange={setCode} onComplete={verify} disabled={busy} />
          <ErrorText message={error} />
          <button type="submit" className="btn-primary h-11" disabled={busy || !isFullCode(code)}>
            {busy && <Spinner />} Verify
          </button>
          <div className="flex items-center justify-between text-sm">
            <TextLink onClick={() => setStep("email")}>Use a different email</TextLink>
            {resendIn > 0 ? (
              <span className="text-ink-3">Resend in {resendIn}s</span>
            ) : (
              <TextLink onClick={() => sendCode()}>Resend code</TextLink>
            )}
          </div>
        </form>
      )}

      {view !== "signin" && step === "password" && (
        <form onSubmit={finish} className="flex flex-col gap-3">
          <p className="flex items-center gap-1.5 text-sm text-success">
            <Icon name="verified" size={16} /> {email} verified
          </p>
          {view === "signup" && (
            <Field label="Your name">
              <input className="input w-full" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" autoFocus required maxLength={100} />
            </Field>
          )}
          <Field label={view === "signup" ? "Create a password" : "New password"}>
            <PasswordInput value={password} onChange={setPassword} autoComplete="new-password" autoFocus={view === "reset"} />
          </Field>
          <Field label="Confirm password">
            <PasswordInput value={confirm} onChange={setConfirm} autoComplete="new-password" />
          </Field>
          <PasswordChecklist password={password} confirm={confirm} />
          <ErrorText message={error} />
          <button type="submit" className="btn-primary h-11" disabled={busy}>
            {busy && <Spinner />} {view === "signup" ? "Create account" : "Save password and sign in"}
          </button>
        </form>
      )}

      {view !== "signin" && (
        <p className="text-sm text-ink-2 text-center">
          {view === "signup" ? "Already have an account? " : "Remembered it? "}
          <TextLink onClick={() => go("signin")}>Sign in</TextLink>
        </p>
      )}
    </div>
  );
}
