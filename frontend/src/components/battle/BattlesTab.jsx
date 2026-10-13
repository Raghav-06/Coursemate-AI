import { useCallback, useEffect, useState } from "react";
import { api } from "../../api";
import { useAuth } from "../../auth";
import { navigate } from "../../hooks";
import { Icon, Segmented, Spinner, timeAgo, toast } from "../ui";
import UnitChecklist from "../study/UnitChecklist";
import JoinBattleDialog from "./JoinBattleDialog";

const ordinal = (n) => `${n}${n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th"}`;

/**
 * Quiz battles in Practice: start one from chosen units (you get a join code
 * to share with people in this course), join a running one, see past results.
 */
export default function BattlesTab({ notebook, units, sources }) {
  const { user } = useAuth();
  const [unitIds, setUnitIds] = useState([]);
  const [count, setCount] = useState(10);
  const [seconds, setSeconds] = useState(20);
  const [difficulty, setDifficulty] = useState("medium");
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [joining, setJoining] = useState(false);
  const ready = sources.filter((s) => s.status === "ready" && s.kind !== "past_paper").length;

  const load = useCallback(
    () =>
      api.listBattles(notebook.id).then(
        (d) => {
          setData(d);
          setError(null);
        },
        (err) => setError(err.message)
      ),
    [notebook.id]
  );

  useEffect(() => {
    load();
    const timer = setInterval(load, 10_000); // new lobbies from classmates
    return () => clearInterval(timer);
  }, [load]);

  const start = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { code } = await api.createBattle(notebook.id, { unitIds, count, seconds, difficulty });
      navigate(`/battle/${code}`);
    } catch (err) {
      toast(err.message, "error");
      setBusy(false);
    }
  };

  const joinLive = async (battle) => {
    try {
      await api.joinBattle(battle.code);
      navigate(`/battle/${battle.code}`);
    } catch (err) {
      toast(err.message, "error");
      load();
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <form onSubmit={start} className="rounded-3xl bg-accent-soft text-accent-soft-fg p-5 flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-4">
          <span className="w-12 h-12 rounded-2xl bg-panel/60 flex items-center justify-center">
            <Icon name="sports_esports" size={26} />
          </span>
          <div className="flex-1 min-w-[180px]">
            <p className="font-display text-lg font-semibold">Quiz battle</p>
            <p className="text-sm opacity-80">
              Race classmates in this course: everyone gets the same timed questions, and fast correct answers score more.
              {notebook.memberCount <= 1 && " Share the course first so others can join."}
            </p>
          </div>
          <button type="button" className="btn-outline bg-panel/60! h-10" onClick={() => setJoining(true)}>
            <Icon name="dialpad" size={18} /> Enter a code
          </button>
        </div>
        {ready === 0 ? (
          <p className="text-sm opacity-80">Add course material and wait for it to finish processing to start a battle.</p>
        ) : (
          <div className="rounded-2xl bg-panel text-ink p-4 flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-ink-2">Questions from</span>
              <UnitChecklist units={units} sources={sources} value={unitIds} onChange={setUnitIds} />
            </div>
            <div className="flex flex-wrap gap-x-8 gap-y-4">
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-ink-2">Questions</span>
                <Segmented label="Number of questions" value={count} onChange={setCount} options={[[5, "5"], [10, "10"], [15, "15"]]} />
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-ink-2">Time per question</span>
                <Segmented label="Seconds per question" value={seconds} onChange={setSeconds} options={[[10, "10s"], [20, "20s"], [30, "30s"]]} />
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-ink-2">Difficulty</span>
                <Segmented
                  label="Difficulty"
                  value={difficulty}
                  onChange={setDifficulty}
                  options={[
                    ["easy", "Easy"],
                    ["medium", "Medium"],
                    ["hard", "Hard"],
                  ]}
                />
              </div>
            </div>
            <button type="submit" className="btn-primary h-10 self-start px-5" disabled={busy}>
              {busy ? <Spinner /> : <Icon name="play_arrow" size={20} />} {busy ? "Writing questions…" : "Create battle"}
            </button>
          </div>
        )}
      </form>

      {error && <p className="text-sm text-danger">{error}</p>}
      {!data && !error && <div className="skeleton h-16 rounded-2xl" />}

      {data?.live.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="font-display text-base font-semibold">Happening now</h3>
          {data.live.map((b) => (
            <div key={b.code} className="flex items-center gap-3 p-3 pl-4 rounded-2xl border border-accent/40 bg-panel">
              <span className="relative flex w-2.5 h-2.5">
                <span className="absolute inline-flex h-full w-full rounded-full bg-success opacity-60 animate-ping" />
                <span className="relative inline-flex w-2.5 h-2.5 rounded-full bg-success" />
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">
                  {b.hostName ?? "Someone"}'s battle · <span className="font-mono tracking-wider">{b.code}</span>
                </p>
                <p className="text-xs text-ink-3">
                  {b.players} player{b.players === 1 ? "" : "s"} · {b.questionCount} questions · {b.phase === "lobby" ? "waiting to start" : "in progress"}
                </p>
              </div>
              <button type="button" className="btn-primary h-9" onClick={() => joinLive(b)}>
                {b.phase === "lobby" ? "Join" : "Rejoin"}
              </button>
            </div>
          ))}
        </section>
      )}

      {data && (
        <section className="flex flex-col gap-2">
          <h3 className="font-display text-base font-semibold">Past battles</h3>
          {data.past.length === 0 ? (
            <p className="text-sm text-ink-3">Your finished battles and their leaderboards appear here.</p>
          ) : (
            data.past.map((b) => {
              const me = b.players.find((p) => p.userId === user?.id);
              return (
                <div key={b.id} className="flex items-center gap-3 p-3 pl-4 rounded-2xl border border-line bg-panel">
                  <Icon name={me?.rank === 1 ? "emoji_events" : "sports_esports"} size={22} className={me?.rank === 1 ? "text-amber-500 shrink-0" : "text-ink-3 shrink-0"} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {me ? `${ordinal(me.rank)} of ${b.players.length}` : `${b.players.length} players`} · {me?.score ?? 0} points
                    </p>
                    <p className="text-xs text-ink-3 truncate">
                      {b.players
                        .slice(0, 4)
                        .map((p) => `${p.name} ${p.score}`)
                        .join(" · ")}
                      {b.players.length > 4 ? " …" : ""} · {timeAgo(b.finishedAt)}
                    </p>
                  </div>
                </div>
              );
            })
          )}
        </section>
      )}

      {joining && <JoinBattleDialog open onClose={() => setJoining(false)} />}
    </div>
  );
}
