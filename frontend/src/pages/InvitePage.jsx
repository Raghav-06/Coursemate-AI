import { useEffect, useState } from "react";
import { api } from "../api";
import { navigate } from "../hooks";
import { Logo, ThemeToggle } from "../components/TopBar";
import { Icon, Spinner } from "../components/ui";
import { useAuth } from "../authContext";
import { toast } from "../components/uiUtils";

/** "#/invite/<token>": join a course someone shared with your email address. */
export default function InvitePage({ token }) {
  const { user, setUser } = useAuth();
  const [invite, setInvite] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.getInvite(token).then(
      (i) => !cancelled && setInvite(i),
      (err) => !cancelled && setError(err.message)
    );
    return () => {
      cancelled = true;
    };
  }, [token]);

  // Signs out but stays on this link, so the right account can accept it.
  const switchAccount = async () => {
    await api.logout().catch(() => {});
    setUser(null);
  };

  const accept = async () => {
    setBusy(true);
    try {
      const { notebookId } = await api.acceptInvite(token);
      navigate(`/notebook/${notebookId}`);
    } catch (err) {
      toast(err.message, "error");
      setBusy(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto scroll-thin">
      <header className="flex items-center justify-between h-16 px-4 sm:px-8">
        <Logo />
        <ThemeToggle />
      </header>
      <main className="max-w-md mx-auto px-4 pt-10 pb-16">
        <div className="panel p-6 sm:p-8 items-center text-center gap-4">
          {!invite && !error && <Spinner className="w-6 h-6 text-ink-3" />}
          {error && (
            <>
              <Icon name="link_off" size={40} className="text-ink-3" />
              <h1 className="font-display text-xl font-semibold">Invite not available</h1>
              <p className="text-sm text-ink-2">{error}</p>
              <button type="button" className="btn-primary" onClick={() => navigate("/")}>
                Go to your courses
              </button>
            </>
          )}
          {invite && (
            <>
              <span className="text-5xl leading-none">{invite.courseEmoji}</span>
              <h1 className="font-display text-2xl font-semibold leading-tight">{invite.courseTitle}</h1>
              <p className="text-sm text-ink-2">
                {invite.inviterName ?? "Someone"} invited <strong className="font-medium">{invite.email}</strong> to {invite.role === "editor" ? "edit" : "view"} this
                course.
              </p>
              {invite.emailMatches ? (
                <button type="button" className="btn-primary h-11 px-6" onClick={accept} disabled={busy}>
                  {busy ? <Spinner /> : <Icon name="group_add" size={20} />} Join the course
                </button>
              ) : (
                <>
                  <p className="text-sm text-danger">
                    You're signed in as {user?.email}. Sign in with {invite.email} to accept this invite.
                  </p>
                  <button type="button" className="btn-outline" onClick={switchAccount}>
                    <Icon name="logout" size={18} /> Use another account
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
