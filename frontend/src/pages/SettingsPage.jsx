import { useEffect, useState } from "react";
import { api } from "../api";
import { navigate } from "../hooks";
import { Logo, ThemeToggle } from "../components/TopBar";
import AccountMenu from "../components/AccountMenu";
import LanguagePicker from "../components/LanguagePicker";
import { IconButton, Spinner, toast } from "../components/ui";

function Section({ title, description, children }) {
  return (
    <section className="rounded-3xl bg-panel border border-line p-5 sm:p-6 flex flex-col gap-4">
      <div>
        <h2 className="font-display text-lg font-semibold">{title}</h2>
        {description && <p className="text-sm text-ink-2 mt-1">{description}</p>}
      </div>
      {children}
    </section>
  );
}

/** Account settings: response language and daily study goal. */
export default function SettingsPage() {
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState(null);
  const [goal, setGoal] = useState("");

  useEffect(() => {
    api.getSettings().then(
      (s) => {
        setSettings(s);
        setGoal(String(s.dailyGoal));
      },
      (err) => setError(err.message)
    );
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
          </>
        )}
      </main>
    </div>
  );
}
