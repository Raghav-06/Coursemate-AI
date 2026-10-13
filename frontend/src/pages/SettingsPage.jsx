import { useEffect, useState } from "react";
import { api } from "../api";
import { navigate } from "../hooks";
import { Logo, ThemeToggle } from "../components/TopBar";
import AccountMenu from "../components/AccountMenu";
import LanguagePicker from "../components/LanguagePicker";
import { Icon, IconButton, Spinner, toast } from "../components/ui";

function Section({ title, description, children }) {
  return (
    <section className="rounded-2xl bg-panel border border-line/70 shadow-card p-5 sm:p-6 flex flex-col gap-4">
      <div>
        <h2 className="font-display text-lg font-semibold">{title}</h2>
        {description && <p className="text-sm text-ink-2 mt-1">{description}</p>}
      </div>
      {children}
    </section>
  );
}

const AI_ROWS = [
  ["chat", "Chat & generation", "Answers, guides, flashcards, quizzes, grading, plans", "forum"],
  ["embeddings", "Search (embeddings)", "Finds the passages each answer cites", "manage_search"],
  ["vision", "Image reading", "Photos of handwritten notes and scanned PDFs", "image"],
  ["transcription", "Transcription", "Lecture recordings", "mic"],
];

// Which models the server uses and where your notes go (from /health; no keys).
function AiPrivacy({ ai }) {
  if (!ai) return <p className="text-sm text-ink-3">The server didn't report its models.</p>;
  const allLocal = AI_ROWS.every(([key]) => ai[key]?.local);
  return (
    <>
      <ul className="flex flex-col divide-y divide-line/70">
        {AI_ROWS.map(([key, label, use, icon]) => {
          const m = ai[key];
          return (
            <li key={key} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
              <span className="w-9 h-9 shrink-0 rounded-xl bg-panel-2 text-ink-2 flex items-center justify-center">
                <Icon name={icon} size={20} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink">{label}</p>
                <p className="text-xs text-ink-3">{use}</p>
              </div>
              <div className="text-right min-w-0 max-w-[50%]">
                <p className="text-sm font-mono text-ink truncate" title={m?.model}>
                  {m?.model ?? "—"}
                </p>
                <p className={`text-xs truncate ${m?.local ? "text-success" : "text-ink-3"}`}>{m ? (m.local ? "on this computer" : m.host) : ""}</p>
              </div>
            </li>
          );
        })}
      </ul>
      <p className={`flex items-start gap-2 rounded-xl px-3 py-2.5 text-sm ${allLocal ? "bg-success/10 text-success" : "bg-panel-2 text-ink-2"}`}>
        <Icon name={allLocal ? "verified_user" : "info"} size={18} className="mt-0.5 shrink-0" />
        <span>
          {allLocal
            ? "Every model runs on the server's own machine, so your notes never leave it."
            : "Text from your sources is sent to these providers to answer and generate. Your server admin can switch any of them to a local model (e.g. Ollama or LM Studio) so notes never leave the machine."}
        </span>
      </p>
    </>
  );
}

/** Account settings: response language, daily study goal, and the AI models in use. */
export default function SettingsPage() {
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState(null);
  const [goal, setGoal] = useState("");
  const [health, setHealth] = useState(null);

  useEffect(() => {
    api.getSettings().then(
      (s) => {
        setSettings(s);
        setGoal(String(s.dailyGoal));
      },
      (err) => setError(err.message)
    );
    api.health().then(setHealth, () => setHealth({}));
  }, []);

  const save = async (patch, message = "Saved") => {
    try {
      const s = await api.updateSettings(patch);
      setSettings(s);
      setGoal(String(s.dailyGoal));
      toast(message);
    } catch (err) {
      toast(err.message, "error");
    }
  };

  const goalValue = Number(goal);
  const goalValid = Number.isInteger(goalValue) && goalValue >= 1 && goalValue <= 500;

  return (
    <div className="h-full overflow-y-auto scroll-thin">
      <header className="sticky top-0 z-20 bg-bg/90 backdrop-blur-sm flex items-center justify-between h-16 px-4 sm:px-8">
        <div className="flex items-center gap-2">
          <IconButton icon="arrow_back" label="Back to courses" onClick={() => navigate("/")} />
          <Logo />
        </div>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <AccountMenu />
        </div>
      </header>
      <main className="max-w-2xl mx-auto px-4 sm:px-8 pb-16 flex flex-col gap-5">
        <h1 className="font-display text-3xl font-semibold mt-4 mb-2">Settings</h1>
        {error && <p className="text-sm text-danger">{error}</p>}
        {!settings && !error && <Spinner className="w-6 h-6 text-ink-3" />}
        {settings && (
          <>
            <Section
              title="Response language"
              description="The language CourseMate uses for answers, guides, flashcards, quizzes, feedback and plans. You can also set a different language for one course from its header."
            >
              <LanguagePicker
                languages={settings.languages}
                language={settings.language}
                bilingual={settings.bilingual}
                onChange={(next) => save(next, "Language saved")}
              />
            </Section>
            <Section title="Daily goal" description="Study actions per day — each flashcard review, quiz answer, graded answer, explanation or chat question counts as one. Meet it on consecutive days to build a streak.">
              <form
                className="flex flex-wrap items-center gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (goalValid) save({ dailyGoal: goalValue }, "Daily goal saved");
                }}
              >
                <input className="input w-28!" type="number" min={1} max={500} value={goal} onChange={(e) => setGoal(e.target.value)} aria-label="Actions per day" />
                <span className="text-sm text-ink-2">actions a day</span>
                <button type="submit" className="btn-primary ml-auto" disabled={!goalValid || goalValue === settings.dailyGoal}>
                  Save
                </button>
              </form>
            </Section>
            <Section title="AI & privacy" description="The models this CourseMate server uses. API keys stay on the server and are never shown here.">
              {health ? <AiPrivacy ai={health.ai} /> : <Spinner className="w-5 h-5 text-ink-3" />}
            </Section>
          </>
        )}
      </main>
    </div>
  );
}
