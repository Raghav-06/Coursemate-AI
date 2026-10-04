import { useEffect, useState } from "react";
import { signInWithGoogle } from "../auth";
import { ThemeToggle } from "../components/TopBar";
import { Icon } from "../components/ui";
import EmailAuth from "../components/EmailAuth";

// Google's "G" mark, as required on Sign in with Google buttons.
function GoogleMark({ className = "w-5 h-5" }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

function GoogleButton({ large = false, full = false }) {
  return (
    <button
      type="button"
      onClick={signInWithGoogle}
      className={`inline-flex items-center justify-center gap-3 rounded-full bg-panel border border-line text-ink font-medium shadow-sm hover:bg-panel-2 hover:shadow-pop transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 ${
        large ? "h-12 px-7 text-base" : "h-10 px-5 text-sm"
      } ${full ? "w-full" : ""}`}
    >
      <GoogleMark className={large ? "w-5 h-5" : "w-4 h-4"} />
      Sign in with Google
    </button>
  );
}

const FEATURES = [
  {
    icon: "upload_file",
    title: "Upload your sources",
    body: "Add PDFs, Word docs, slides, websites, arXiv papers or pasted text — up to 50 sources per notebook.",
  },
  {
    icon: "forum",
    title: "Ask, and get cited answers",
    body: "Chat with everything at once. Every answer is grounded in your sources, with inline citations you can click to read the passage.",
  },
  {
    icon: "summarize",
    title: "Get the gist instantly",
    body: "Every source gets a guide with a summary and key topics, and each notebook gets an overview with suggested questions to start from.",
  },
];

export default function LoginPage({ serverError }) {
  const [authError, setAuthError] = useState(null);

  // The OAuth callback reports failures as ?authError=… ; show it once, then tidy the URL.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const message = params.get("authError");
    if (message) {
      setAuthError(message);
      params.delete("authError");
      const query = params.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
    }
  }, []);

  return (
    <div className="h-full overflow-y-auto scroll-thin">
      <header className="sticky top-0 z-20 bg-bg/90 backdrop-blur flex items-center justify-between h-16 px-4 sm:px-8">
        <div className="flex items-center gap-2.5">
          <img src="/favicon.svg" alt="" className="w-8 h-8" />
          <span className="font-display text-[19px] font-semibold tracking-tight">CourseMate AI</span>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <a href="#sign-in" onClick={(e) => { e.preventDefault(); document.getElementById("sign-in")?.scrollIntoView({ behavior: "smooth" }); }} className="btn-primary hidden sm:inline-flex">
            Sign in
          </a>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-8">
        <section className="pt-10 sm:pt-16 pb-14 grid lg:grid-cols-[1fr_420px] gap-10 lg:gap-14 items-center">
          <div className="text-center lg:text-left flex flex-col items-center lg:items-start">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft text-accent-soft-fg px-3 py-1 text-xs font-medium mb-6">
              <Icon name="auto_awesome" size={14} />
              Your AI-powered research and study partner
            </span>
            <h1 className="font-display text-4xl sm:text-[54px] font-semibold tracking-tight leading-[1.08]">
              Understand anything,{" "}
              <span className="bg-gradient-to-r from-blue-600 via-violet-500 to-rose-500 bg-clip-text text-transparent dark:from-blue-300 dark:via-violet-300 dark:to-rose-300">
                grounded in your sources
              </span>
            </h1>
            <p className="mt-6 text-lg text-ink-2 max-w-xl">
              Create a notebook, add your documents and links, then ask questions and get answers grounded in your sources,
              with citations you can click to read the exact passage.
            </p>
          </div>

          <div id="sign-in" className="w-full max-w-[420px] mx-auto rounded-3xl bg-panel border border-line shadow-sm p-6 sm:p-7 flex flex-col gap-5">
            {(authError || serverError) && (
              <div role="alert" className="flex items-start gap-2 rounded-xl border border-danger/40 bg-danger/10 text-danger px-3 py-2.5 text-sm text-left">
                <Icon name="error" size={18} className="mt-px shrink-0" />
                <span>{authError || serverError}</span>
              </div>
            )}
            <GoogleButton large full />
            <div className="flex items-center gap-3 text-xs text-ink-3 uppercase tracking-wide">
              <span className="flex-1 h-px bg-line" />
              or
              <span className="flex-1 h-px bg-line" />
            </div>
            <EmailAuth />
            <p className="text-xs text-ink-3 text-center">Your notebooks are private to your account.</p>
          </div>
        </section>

        <section className="grid sm:grid-cols-3 gap-4 pb-20">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-2xl bg-panel border border-line p-6">
              <span className="w-11 h-11 rounded-full bg-accent-soft text-accent-soft-fg flex items-center justify-center mb-4">
                <Icon name={f.icon} size={22} />
              </span>
              <h2 className="font-display text-lg font-semibold mb-1.5">{f.title}</h2>
              <p className="text-sm text-ink-2 leading-relaxed">{f.body}</p>
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}
