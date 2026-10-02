import { useEffect, useRef, useState } from "react";
import { useAuth } from "../auth";
import { Icon } from "./ui";

function Avatar({ user, size = 32 }) {
  const [broken, setBroken] = useState(false);
  const initial = (user.givenName || user.name || user.email || "?").trim().charAt(0).toUpperCase();
  if (user.avatarUrl && !broken) {
    return (
      <img
        src={user.avatarUrl}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
        style={{ width: size, height: size }}
        className="rounded-full object-cover"
      />
    );
  }
  return (
    <span style={{ width: size, height: size, fontSize: Math.round(size * 0.44) }} className="rounded-full bg-violet-600 text-white flex items-center justify-center font-medium">
      {initial}
    </span>
  );
}

/** Google account chip in the top-right, with the user's details and Sign out. */
export default function AccountMenu() {
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const close = (e) => !ref.current?.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!user) return null;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="rounded-full p-1 hover:bg-panel-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        aria-label={`Google Account: ${user.name || user.email}`}
        title={`${user.name ?? ""}\n${user.email}`}
      >
        <Avatar user={user} />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full mt-2 z-[60] w-72 rounded-3xl bg-panel-2 border border-line shadow-pop p-4 animate-fade-in">
          <p className="text-center text-sm text-ink-2 truncate">{user.email}</p>
          <div className="flex flex-col items-center gap-2 my-4">
            <Avatar user={user} size={72} />
            <p className="font-display text-lg font-medium">Hi, {user.givenName || user.name?.split(" ")[0] || "there"}!</p>
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={signOut}
            className="w-full flex items-center justify-center gap-2 h-10 rounded-full bg-panel hover:bg-panel-3 text-sm font-medium border border-line"
          >
            <Icon name="logout" size={18} />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
