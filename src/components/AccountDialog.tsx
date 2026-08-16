import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Check, Cloud, Laptop, LoaderCircle, LogOut, Mail, RefreshCw, ShieldCheck, Smartphone, Trash2, X } from "lucide-react";
import { authClient, loadAuthAvailability, type AuthAvailability, type AuthSessionData } from "../lib/auth";
import type { ProgressSyncState } from "../lib/progressSync";
import type { AppState } from "../types";
import { useDialogFocus } from "../hooks/useDialogFocus";

type AuthMode = "signin" | "signup" | "forgot" | "reset";
type ListedSession = AuthSessionData["session"];

function errorText(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) return String(error.message);
  return "Something went wrong. Please try again.";
}

function deviceName(userAgent?: string | null): string {
  if (!userAgent) return "Unknown device";
  const browser = /Edg\//.test(userAgent) ? "Edge" : /Chrome\//.test(userAgent) ? "Chrome" : /Safari\//.test(userAgent) ? "Safari" : /Firefox\//.test(userAgent) ? "Firefox" : "Browser";
  const device = /iPhone|iPad/.test(userAgent) ? "iPhone or iPad" : /Android/.test(userAgent) ? "Android" : /Macintosh/.test(userAgent) ? "Mac" : /Windows/.test(userAgent) ? "Windows" : "device";
  return `${browser} on ${device}`;
}

function syncCopy(sync: ProgressSyncState): string {
  if (sync.status === "saved") return sync.updatedAt ? `Saved ${new Date(sync.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Progress saved";
  if (sync.status === "syncing" || sync.status === "connecting") return "Saving progress…";
  if (sync.status === "offline") return "Offline · changes stay on this device";
  if (sync.status === "error") return "Progress will retry automatically";
  return "Stored on this device";
}

export function AccountDialog({ open, onClose, session, sessionPending, refetchSession, sync, state }: {
  open: boolean;
  onClose: () => void;
  session?: AuthSessionData | null;
  sessionPending: boolean;
  refetchSession: () => Promise<unknown> | void;
  sync: ProgressSyncState;
  state: AppState;
}) {
  const resetToken = new URLSearchParams(window.location.search).get("token") ?? undefined;
  const [mode, setMode] = useState<AuthMode>(resetToken ? "reset" : "signin");
  const [availability, setAvailability] = useState<AuthAvailability>();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string }>();
  const [working, setWorking] = useState(false);
  const [sessions, setSessions] = useState<ListedSession[]>([]);
  const cardRef = useRef<HTMLElement>(null);
  useDialogFocus(open, cardRef, onClose);

  useEffect(() => {
    if (!open) return;
    setMessage(undefined);
    void loadAuthAvailability().then(setAvailability);
  }, [open]);

  useEffect(() => {
    if (!open || !session) return;
    void authClient.listSessions().then(({ data }) => setSessions((data ?? []) as ListedSession[]));
  }, [open, session]);

  const progressCounts = useMemo(() => ({
    learning: Object.values(state.wordLists).filter((item) => item.status === "learning").length,
    known: Object.values(state.wordLists).filter((item) => item.status === "known").length,
    characters: Object.values(state.mastery).filter((item) => item.kind === "character" && (item.skills.recognition ?? 0) > 0).length,
  }), [state.mastery, state.wordLists]);

  if (!open) return null;

  const submitEmail = async (event: FormEvent) => {
    event.preventDefault();
    setMessage(undefined);
    if (mode === "signup" && password !== confirmPassword) {
      setMessage({ kind: "error", text: "Passwords do not match." });
      return;
    }
    setWorking(true);
    try {
      if (mode === "signup") {
        const result = await authClient.signUp.email({ name: name.trim(), email: email.trim(), password, callbackURL: "/learn" });
        if (result.error) throw result.error;
        setMessage({ kind: "success", text: "Check your email to verify your account. Your progress remains safe on this device." });
      } else if (mode === "signin") {
        const result = await authClient.signIn.email({ email: email.trim(), password, callbackURL: "/learn" });
        if (result.error) throw result.error;
        await refetchSession();
      } else if (mode === "forgot") {
        const result = await authClient.requestPasswordReset({ email: email.trim(), redirectTo: `${window.location.origin}/reset-password` });
        if (result.error) throw result.error;
        setMessage({ kind: "success", text: "If an account exists for this email, a reset link is on its way." });
      } else if (resetToken) {
        if (password !== confirmPassword) throw new Error("Passwords do not match.");
        const result = await authClient.resetPassword({ newPassword: password, token: resetToken });
        if (result.error) throw result.error;
        window.history.replaceState({}, "", "/learn");
        setMode("signin");
        setMessage({ kind: "success", text: "Password changed. You can sign in now." });
        setPassword("");
        setConfirmPassword("");
      }
    } catch (error) {
      setMessage({ kind: "error", text: errorText(error) });
    } finally {
      setWorking(false);
    }
  };

  const googleSignIn = async () => {
    setWorking(true);
    setMessage(undefined);
    const result = await authClient.signIn.social({ provider: "google", callbackURL: `${window.location.origin}/learn` });
    if (result?.error) {
      setMessage({ kind: "error", text: result.error.message || "Google sign-in could not start." });
      setWorking(false);
    }
  };

  const signOut = async () => {
    setWorking(true);
    await authClient.signOut();
    await refetchSession();
    setWorking(false);
    onClose();
  };

  const close = () => {
    if (window.location.pathname === "/reset-password") window.history.replaceState({}, "", "/learn");
    onClose();
  };

  return <div className="account-backdrop" onClick={close}>
    <section ref={cardRef} className="account-card" role="dialog" aria-modal="true" aria-labelledby="account-title" tabIndex={-1} onClick={(event) => event.stopPropagation()}>
      <button data-dialog-autofocus className="account-close" onClick={close} aria-label="Close account"><X size={20}/></button>
      {sessionPending ? <div className="account-loading"><LoaderCircle className="spin"/><span>Opening your account…</span></div> : session ? <div className="account-view">
        <header className="account-profile"><div className="account-avatar">{session.user.image ? <img src={session.user.image} alt="" referrerPolicy="no-referrer"/> : session.user.name.slice(0, 1).toUpperCase()}</div><div><span className="eyebrow">MY ACCOUNT</span><h2 id="account-title">{session.user.name}</h2><p>{session.user.email}</p></div></header>

        <div className={`sync-card ${sync.status}`}><Cloud size={20}/><div><strong>{syncCopy(sync)}</strong><small>Words, characters, settings, and study history</small></div>{sync.status === "saved" && <Check size={17}/>}</div>

        <div className="account-progress-grid"><span><strong>{progressCounts.learning}</strong><small>Learning</small></span><span><strong>{progressCounts.known}</strong><small>Known</small></span><span><strong>{progressCounts.characters}</strong><small>Characters</small></span></div>

        <section className="session-section"><div><ShieldCheck size={18}/><span><strong>Signed-in devices</strong><small>You can end any session you do not recognize.</small></span></div><div className="session-list">{sessions.map((item) => {
          const current = item.token === session.session.token;
          const mobile = /iPhone|iPad|Android/.test(item.userAgent ?? "");
          return <article key={item.id}>{mobile ? <Smartphone size={18}/> : <Laptop size={18}/>}<span><strong>{deviceName(item.userAgent)}{current ? " · This device" : ""}</strong><small>Active until {new Date(item.expiresAt).toLocaleDateString()}</small></span>{!current && <button onClick={async () => { await authClient.revokeSession({ token: item.token }); setSessions((list) => list.filter((sessionItem) => sessionItem.id !== item.id)); }}>End</button>}</article>;
        })}</div></section>

        <div className="account-actions"><button onClick={signOut} disabled={working}><LogOut size={17}/> Sign out</button><button className="danger-link" onClick={async () => {
          if (!window.confirm("Delete your MyHSK account and synchronized progress? Progress on this device will remain until you clear it.")) return;
          setWorking(true);
          const result = await authClient.deleteUser({ callbackURL: "/" });
          if (result.error) { setMessage({ kind: "error", text: result.error.message || "Account could not be deleted." }); setWorking(false); }
        }}><Trash2 size={15}/> Delete account</button></div>
        {message && <p className={`auth-message ${message.kind}`} role="status">{message.text}</p>}
      </div> : <div className="auth-view">
        <header><span className="account-brand-mark">汉</span><span className="eyebrow">MYHSK ACCOUNT</span><h2 id="account-title">{mode === "signup" ? "Save your progress" : mode === "forgot" ? "Reset your password" : mode === "reset" ? "Choose a new password" : "Welcome back"}</h2><p>{mode === "signup" ? "Create one account for secure sessions and progress on every device." : mode === "signin" ? "Continue exactly where you stopped." : "We will send a secure, time-limited link."}</p></header>

        {(mode === "signin" || mode === "signup") && availability?.google && <button className="google-button" onClick={googleSignIn} disabled={working}><b>G</b> Continue with Google</button>}
        {(mode === "signin" || mode === "signup") && availability?.google && availability.email && <div className="auth-divider"><span>or use email</span></div>}

        {availability && !availability.email && (mode !== "reset") ? <div className="auth-unavailable"><RefreshCw size={20}/><div><strong>Email accounts are being connected</strong><p>You can continue learning without an account. No progress will be lost on this device.</p></div></div> : <form onSubmit={submitEmail}>
          {mode === "signup" && <label><span>Name</span><input required minLength={2} maxLength={80} value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" placeholder="Your name"/></label>}
          {mode !== "reset" && <label><span>Email</span><div><Mail size={16}/><input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" placeholder="you@example.com"/></div></label>}
          {mode !== "forgot" && <label><span>{mode === "reset" ? "New password" : "Password"}</span><input required minLength={10} maxLength={128} type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === "signin" ? "current-password" : "new-password"} placeholder="At least 10 characters"/></label>}
          {(mode === "signup" || mode === "reset") && <label><span>Confirm password</span><input required minLength={10} maxLength={128} type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" placeholder="Type it again"/></label>}
          <button className="auth-submit" disabled={working}>{working && <LoaderCircle className="spin" size={17}/>} {mode === "signup" ? "Create account" : mode === "forgot" ? "Send reset link" : mode === "reset" ? "Change password" : "Sign in"}</button>
        </form>}

        {message && <p className={`auth-message ${message.kind}`} role="status" aria-live="polite">{message.text}</p>}
        <footer>{mode === "signin" ? <><button onClick={() => { setMode("forgot"); setMessage(undefined); }}>Forgot password?</button><span>New here? <button onClick={() => { setMode("signup"); setMessage(undefined); }}>Create an account</button></span></> : <button onClick={() => { setMode("signin"); setMessage(undefined); }}>← Back to sign in</button>}</footer>
        <small className="auth-privacy"><ShieldCheck size={13}/> An account is optional. <a href="/privacy">Read our privacy policy.</a></small>
      </div>}
    </section>
  </div>;
}
