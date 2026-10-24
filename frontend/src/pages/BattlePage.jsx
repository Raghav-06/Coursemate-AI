import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { navigate } from "../hooks";
import { Logo, ThemeToggle } from "../components/TopBar";
import { Icon, IconButton, Spinner } from "../components/ui";
import { useAuth } from "../authContext";
import { copyText, toast } from "../components/uiUtils";

const LETTERS = ["A", "B", "C", "D"];
// Explanations may carry [n] passage markers; battles show the source location instead.
const withoutMarkers = (text) => text.replace(/\s*\[\d+(?:,\s*\d+)*\]/g, "");

// Seconds left until a server deadline, corrected for clock skew.
function useCountdown(deadline, offset) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!deadline) return;
    const timer = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(timer);
  }, [deadline]);
  return deadline ? Math.max(0, (deadline - (now + offset)) / 1000) : 0;
}

function Leaderboard({ players, userId, phase, compact = false }) {
  return (
    <ol className="flex flex-col gap-1.5">
      {players.map((p) => (
        <li
          key={p.userId}
          className={`flex items-center gap-3 rounded-xl px-3 ${compact ? "py-1.5" : "py-2.5"} ${p.userId === userId ? "bg-accent-soft text-accent-soft-fg" : "bg-panel-2"}`}
        >
          <span className={`w-6 text-center text-sm font-semibold tabular-nums ${p.rank === 1 && phase !== "lobby" ? "text-amber-500" : "text-ink-3"}`}>
            {phase === "lobby" ? "•" : p.rank}
          </span>
          <span className="flex-1 min-w-0 truncate text-sm font-medium">
            {p.name}
            {p.userId === userId && " (you)"}
          </span>
          {phase === "question" && (
            <Icon name={p.answered ? "check_circle" : "more_horiz"} size={18} className={p.answered ? "text-success" : "text-ink-3"} filled={p.answered} />
          )}
          {phase !== "lobby" && <span className="text-sm font-semibold tabular-nums">{p.score}</span>}
        </li>
      ))}
    </ol>
  );
}

function Lobby({ state, userId, onStart, onJoin, onLeave, busy }) {
  const link = `${window.location.origin}${window.location.pathname}#/battle/${state.code}`;
  return (
    <div className="flex flex-col items-center gap-6 text-center">
      <div>
        <p className="text-sm text-ink-3">{state.notebookTitle}</p>
        <h1 className="font-display text-2xl font-semibold mt-1">Quiz battle lobby</h1>
      </div>
      <div className="flex flex-col items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-3">Join code</span>
        <button
          type="button"
          onClick={() => copyText(state.code)}
          title="Copy the code"
          className="font-mono text-4xl sm:text-5xl font-bold tracking-[0.25em] pl-[0.25em] px-6 py-3 rounded-2xl bg-panel-2 hover:bg-panel-3 text-ink"
        >
          {state.code}
        </button>
        <button type="button" className="text-xs text-accent hover:underline" onClick={() => copyText(link)}>
          Copy invite link
        </button>
        <p className="text-xs text-ink-3 max-w-xs">
          People in this course join from Practice → Battles, or with this code on the home page. {state.questionCount} questions · {state.seconds}s each.
        </p>
      </div>
      <div className="w-full max-w-sm text-left">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-3 mb-2">
          {state.players.length} player{state.players.length === 1 ? "" : "s"}
        </h2>
        <Leaderboard players={state.players} userId={userId} phase="lobby" />
      </div>
      {!state.joined ? (
        <button type="button" className="btn-primary h-11 px-8" onClick={onJoin} disabled={busy}>
          {busy ? <Spinner /> : <Icon name="login" size={20} />} Join battle
        </button>
      ) : state.isHost ? (
        <div className="flex flex-col items-center gap-2">
          <button type="button" className="btn-primary h-11 px-8" onClick={onStart} disabled={busy}>
            {busy ? <Spinner /> : <Icon name="play_arrow" size={22} />} Start battle
          </button>
          <button type="button" className="btn-ghost text-sm" onClick={onLeave}>
            Close lobby
          </button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2">
          <p className="flex items-center gap-2 text-sm text-ink-2">
            <Spinner /> Waiting for the host to start…
          </p>
          <button type="button" className="btn-ghost text-sm" onClick={onLeave}>
            Leave
          </button>
        </div>
      )}
    </div>
  );
}

function QuestionView({ state, userId, offset, onAnswer, answering }) {
  const left = useCountdown(state.deadline, offset);
  const q = state.question;
  const reveal = state.phase === "reveal";
  const mine = state.yourAnswer;
  const answeredCount = state.players.filter((p) => p.answered).length;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_260px]">
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between text-sm text-ink-3">
          <span>
            Question {state.index + 1} of {state.questionCount}
            {q.topic ? ` · ${q.topic}` : ""}
          </span>
          <span className="font-semibold tabular-nums text-ink" aria-live="off">
            {reveal ? `Next in ${Math.ceil(left)}s` : `${Math.ceil(left)}s`}
          </span>
        </div>
        {!reveal && (
          <div className="h-2 rounded-full bg-panel-3 overflow-hidden" role="progressbar" aria-label="Time left" aria-valuenow={Math.ceil(left)} aria-valuemin={0} aria-valuemax={state.seconds}>
            <div className={`h-full transition-[width] duration-200 ${left < 5 ? "bg-danger" : "bg-accent"}`} style={{ width: `${(left / state.seconds) * 100}%` }} />
          </div>
        )}
        <h1 className="font-display text-xl sm:text-2xl font-semibold leading-snug">{q.text}</h1>
        <div className="grid gap-2.5 sm:grid-cols-2">
          {q.options.map((option, i) => {
            const chosen = mine?.choice === i;
            const correct = reveal && q.answerIndex === i;
            const wrong = reveal && chosen && !correct;
            return (
              <button
                key={i}
                type="button"
                disabled={Boolean(mine) || reveal || answering}
                onClick={() => onAnswer(i)}
                className={`flex items-start gap-3 text-left rounded-2xl border-2 p-4 transition-colors ${
                  correct
                    ? "border-success bg-success/10"
                    : wrong
                      ? "border-danger bg-danger/10"
                      : chosen
                        ? "border-accent bg-accent-soft"
                        : "border-line bg-panel hover:enabled:border-accent/60 hover:enabled:bg-panel-2 disabled:opacity-70"
                }`}
              >
                <span
                  className={`w-7 h-7 shrink-0 rounded-lg flex items-center justify-center text-sm font-bold ${correct ? "bg-success text-white" : wrong ? "bg-danger text-white" : "bg-panel-3 text-ink-2"}`}
                >
                  {LETTERS[i]}
                </span>
                <span className="text-[15px] leading-6 text-ink">{option}</span>
              </button>
            );
          })}
        </div>
        {!reveal && mine && (
          <p className="text-sm text-ink-2 flex items-center gap-2">
            <Icon name="lock" size={16} /> Answer locked in · {answeredCount} of {state.players.length} answered
          </p>
        )}
        {!reveal && !mine && <p className="text-xs text-ink-3">Press 1–4 to answer.</p>}
        {reveal && (
          <div className="rounded-2xl bg-panel-2 p-4 flex flex-col gap-2 animate-fade-in">
            <p className={`font-semibold ${mine?.correct ? "text-success" : "text-ink"}`}>
              {mine ? (mine.correct ? `Correct! +${mine.points} points` : "Not quite.") : "Time's up — no answer."}
            </p>
            {q.explanation && <p className="text-sm text-ink-2 leading-6">{withoutMarkers(q.explanation)}</p>}
            {q.citation?.location && <p className="text-xs text-ink-3">From your sources: {q.citation.location}</p>}
          </div>
        )}
      </div>
      <aside className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-3">Leaderboard</h2>
        <Leaderboard players={state.players} userId={userId} phase={state.phase} compact />
      </aside>
    </div>
  );
}

function Results({ state, userId }) {
  const me = state.players.find((p) => p.userId === userId);
  const podium = state.players.slice(0, 3);
  return (
    <div className="flex flex-col gap-6">
      <div className="text-center flex flex-col items-center gap-2">
        <Icon name="emoji_events" size={44} className="text-amber-500" filled />
        <h1 className="font-display text-2xl font-semibold">{podium[0]?.userId === userId ? "You won!" : `${podium[0]?.name ?? "Nobody"} wins`}</h1>
        {me && (
          <p className="text-sm text-ink-2">
            You finished #{me.rank} of {state.players.length} with {me.score} points ({me.correct}/{state.questionCount} correct).
          </p>
        )}
      </div>
      <Leaderboard players={state.players} userId={userId} phase="finished" />
      {state.results && (
        <section className="flex flex-col gap-2">
          <h2 className="font-display text-base font-semibold">Your answers</h2>
          {state.results.map((r, i) => (
            <details key={i} className="rounded-2xl border border-line bg-panel p-3 group">
              <summary className="flex items-start gap-2 cursor-pointer list-none">
                <Icon name={r.correct ? "check_circle" : "cancel"} size={20} className={r.correct ? "text-success shrink-0" : "text-danger shrink-0"} filled />
                <span className="flex-1 text-sm text-ink">{r.question}</span>
                <span className="text-xs tabular-nums text-ink-3">+{r.points}</span>
              </summary>
              <div className="mt-2 pl-7 text-sm text-ink-2 flex flex-col gap-1">
                <p>
                  Answer: <strong className="font-medium text-ink">{r.options[r.answerIndex]}</strong>
                  {r.choice !== null && r.choice !== r.answerIndex && <> · you chose {r.options[r.choice]}</>}
                </p>
                {r.explanation && <p className="text-ink-3">{withoutMarkers(r.explanation)}</p>}
              </div>
            </details>
          ))}
        </section>
      )}
      <p className="text-xs text-ink-3 text-center">Results are saved, and every answer counts toward your daily goal and topic mastery.</p>
    </div>
  );
}

/** "#/battle/<code>": the lobby, the live questions and the results of a quiz battle. */
export default function BattlePage({ code }) {
  const { user } = useAuth();
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);
  const [offset, setOffset] = useState(0);
  const [connected, setConnected] = useState(true);
  const [busy, setBusy] = useState(false);
  const [answering, setAnswering] = useState(false);
  const stateRef = useRef(null);

  const apply = useCallback((s) => {
    stateRef.current = s;
    setState(s);
    setOffset(s.serverNow - Date.now());
  }, []);

  useEffect(() => {
    let source;
    let cancelled = false;
    api.getBattle(code).then(
      (s) => {
        if (cancelled) return;
        apply(s);
        source = new EventSource(api.battleEventsUrl(code), { withCredentials: true });
        source.onmessage = (e) => {
          setConnected(true);
          apply(JSON.parse(e.data));
        };
        source.onerror = () => {
          setConnected(false);
          // The battle is gone (finished long ago, or the server restarted).
          if (source.readyState === EventSource.CLOSED) setError("The connection to this battle was closed.");
        };
      },
      (err) => !cancelled && setError(err.message)
    );
    return () => {
      cancelled = true;
      source?.close();
    };
  }, [code, apply]);

  const run = async (fn) => {
    setBusy(true);
    try {
      const s = await fn();
      if (s) apply(s);
    } catch (err) {
      toast(err.message, "error");
    } finally {
      setBusy(false);
    }
  };

  const answer = useCallback(
    async (choice) => {
      const s = stateRef.current;
      if (!s || s.phase !== "question" || s.yourAnswer || !s.joined) return;
      setAnswering(true);
      // Show the choice straight away; the server confirms it with the next update.
      stateRef.current = { ...s, yourAnswer: { choice } };
      setState(stateRef.current);
      try {
        await api.answerBattle(code, s.index, choice);
      } catch (err) {
        toast(err.message, "error");
      } finally {
        setAnswering(false);
      }
    },
    [code]
  );

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.closest?.("input, textarea, select")) return;
      const n = Number(e.key);
      if (n >= 1 && n <= 4) answer(n - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [answer]);

  const leave = async () => {
    try {
      await api.leaveBattle(code);
    } catch {
      // gone already
    }
    navigate(state ? `/notebook/${state.notebookId}?view=practice` : "/");
  };

  const back = state ? `/notebook/${state.notebookId}?view=practice` : "/";

  return (
    <div className="h-full overflow-y-auto scroll-thin">
      <header className="flex items-center gap-2 h-16 px-3 sm:px-6">
        <IconButton icon="arrow_back" label="Back to the course" onClick={() => navigate(back)} />
        <Logo compact />
        <span className="ml-1 font-display text-base font-medium">Quiz battle</span>
        <div className="ml-auto flex items-center gap-1">
          {!connected && !error && (
            <span className="flex items-center gap-1.5 text-xs text-ink-3">
              <Spinner className="w-3 h-3" /> Reconnecting…
            </span>
          )}
          <ThemeToggle />
        </div>
      </header>
      <main className="max-w-4xl mx-auto px-4 sm:px-6 pt-4 pb-16">
        {error && (
          <div className="panel p-8 items-center text-center gap-4">
            <Icon name="sports_esports" size={40} className="text-ink-3" />
            <p className="text-ink-2">{error}</p>
            <button type="button" className="btn-primary" onClick={() => navigate(back)}>
              Back
            </button>
          </div>
        )}
        {!state && !error && (
          <div className="flex justify-center py-20 text-ink-3">
            <Spinner className="w-6 h-6" />
          </div>
        )}
        {state && !error && (
          <div className="panel p-5 sm:p-8">
            {state.phase === "lobby" && (
              <Lobby
                state={state}
                userId={user?.id}
                busy={busy}
                onStart={() => run(() => api.startBattle(code))}
                onJoin={() => run(() => api.joinBattle(code))}
                onLeave={leave}
              />
            )}
            {(state.phase === "question" || state.phase === "reveal") &&
              (state.joined ? (
                <QuestionView state={state} userId={user?.id} offset={offset} onAnswer={answer} answering={answering} />
              ) : (
                <div className="flex flex-col items-center gap-3 py-10 text-center">
                  <p className="text-ink-2">This battle has already started.</p>
                  <Leaderboard players={state.players} userId={user?.id} phase={state.phase} compact />
                </div>
              ))}
            {state.phase === "finished" && <Results state={state} userId={user?.id} />}
            {state.phase === "cancelled" && (
              <div className="flex flex-col items-center gap-3 py-10 text-center">
                <Icon name="event_busy" size={40} className="text-ink-3" />
                <p className="text-ink-2">The host closed this battle.</p>
              </div>
            )}
            {(state.phase === "finished" || state.phase === "cancelled") && (
              <div className="mt-6 flex justify-center gap-2">
                <button type="button" className="btn-primary" onClick={() => navigate(back)}>
                  Back to the course
                </button>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
