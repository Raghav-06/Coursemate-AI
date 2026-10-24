import { useEffect, useState } from "react";
import { ThemeToggle } from "../components/TopBar";
import { Icon } from "../components/ui";
import EmailAuth from "../components/EmailAuth";
import { signInWithGoogle } from "../authContext";

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
      className={`inline-flex items-center justify-center gap-3 rounded-xl bg-panel border border-line text-ink font-medium shadow-xs hover:bg-panel-2 hover:shadow-pop transition focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent/60 ${
        large ? "h-12 px-7 text-base" : "h-10 px-5 text-sm"
      } ${full ? "w-full" : ""}`}
    >
      <GoogleMark className={large ? "w-5 h-5" : "w-4 h-4"} />
      Sign in with Google
    </button>
  );
}

const FEATURES = [
  { icon: "style", title: "Flashcards that come back on time", body: "Decks made from your notes, scheduled with spaced repetition so you review just before you'd forget." },
  { icon: "quiz", title: "Quizzes and graded answers", body: "MCQs and 2/5/10-mark questions marked against your own sources, with the points you missed." },
  { icon: "history_edu", title: "Past-paper insights", body: "See which topics get asked most, for how many marks, and where the answers are in your notes." },
  { icon: "event_upcoming", title: "A plan to exam day", body: "A day-by-day revision plan from your weak topics, plus a daily goal and a streak to keep you going." },
  { icon: "mic", title: "Lectures and handwritten notes", body: "Upload recordings and photos of notes — they're transcribed and cited to the minute or page." },
  { icon: "translate", title: "Study in your language", body: "Answers in English, Hindi, Tamil, Bengali and eight more Indian languages — or bilingual." },
];

// A stack of three study cards: the sign-in page's illustration.
function CardsIllustration() {
  return (
    <svg viewBox="0 0 320 200" className="w-full max-w-[340px]" aria-hidden="true">
      <rect x="62" y="34" width="200" height="130" rx="16" className="fill-panel-3" transform="rotate(-8 162 99)" />
      <rect x="62" y="34" width="200" height="130" rx="16" className="fill-accent-soft" transform="rotate(4 162 99)" />
      <rect x="60" y="36" width="200" height="130" rx="16" className="fill-panel stroke-line" strokeWidth="1.5" />
      <rect x="80" y="58" width="90" height="10" rx="5" className="fill-accent" />
      <rect x="80" y="80" width="150" height="7" rx="3.5" className="fill-panel-3" />
      <rect x="80" y="95" width="130" height="7" rx="3.5" className="fill-panel-3" />
      <rect x="80" y="122" width="44" height="24" rx="8" className="fill-panel-2" />
      <rect x="130" y="122" width="44" height="24" rx="8" className="fill-panel-2" />
      <rect x="180" y="122" width="60" height="24" rx="8" className="fill-accent" />
      <path d="M268 30l4 10 10 4-10 4-4 10-4-10-10-4 10-4z" className="fill-gold" />
    </svg>
  );
}

export default function LoginPage({ serverError }) {
  // The OAuth callback reports failures as ?authError=… ; show it once, then tidy the URL.
  const [authError] = useState(() => new URLSearchParams(window.location.search).get("authError"));
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has("authError")) {
      params.delete("authError");
      const query = params.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
    }
  }, []);

  return (
    <div className="h-full overflow-y-auto scroll-thin">
      <header className="sticky top-0 z-20 bg-bg/90 backdrop-blur-sm flex items-center justify-between h-16 px-4 sm:px-8">
        <div className="flex items-center gap-2.5">
          <img src="/favicon.svg" alt="" className="w-8 h-8" />
          <span className="font-display text-[19px] font-semibold">CourseMate AI</span>
        </div>
        <ThemeToggle />
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-8">
        <section className="pt-6 sm:pt-12 pb-14 grid lg:grid-cols-[1fr_420px] gap-10 lg:gap-16 items-center">
          <div className="flex flex-col items-center lg:items-start text-center lg:text-left">
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-accent-soft text-accent-soft-fg px-3 py-1 text-xs font-semibold mb-6">
              <Icon name="school" size={16} />
              Exam prep for college courses
            </span>
            <h1 className="font-display text-4xl sm:text-[56px] font-semibold leading-[1.05]">
              Revise smarter from <em className="text-accent not-italic sm:italic">your own</em> course notes.
            </h1>
            <p className="mt-6 text-lg text-ink-2 max-w-xl">
              Add your lecture slides, notes, recordings and past papers. CourseMate turns them into flashcards, quizzes, graded practice and a plan to exam day —
              and every answer cites the page it came from.
            </p>
            <div className="mt-8 max-lg:hidden">
              <CardsIllustration />
            </div>
          </div>

          <div id="sign-in" className="w-full max-w-[420px] mx-auto rounded-3xl bg-panel border border-line/70 shadow-pop p-6 sm:p-8 flex flex-col gap-5">
            <div>
              <h2 className="font-display text-2xl font-semibold">Sign in</h2>
              <p className="text-sm text-ink-3 mt-1">New here? Signing in creates your account.</p>
            </div>
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
            <p className="text-xs text-ink-3 text-center">Your courses stay private unless you share them.</p>
          </div>
        </section>

        <section className="pb-20">
          <h2 className="font-display text-2xl font-semibold mb-6 text-center lg:text-left">Everything you need before the exam</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {FEATURES.map((f) => (
              <div key={f.title} className="rounded-2xl bg-panel border border-line/70 shadow-card p-5 flex gap-4">
                <span className="w-10 h-10 shrink-0 rounded-xl bg-accent-soft text-accent-soft-fg flex items-center justify-center">
                  <Icon name={f.icon} size={22} />
                </span>
                <div>
                  <h3 className="font-semibold text-ink">{f.title}</h3>
                  <p className="text-sm text-ink-2 leading-relaxed mt-1">{f.body}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
