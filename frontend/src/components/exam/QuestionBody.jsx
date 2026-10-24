import Markdown, { MathText } from "../Markdown";
import { Icon } from "../ui";

// One exam-style question: stem, then the input for its type. Used in the
// question bank (read-only, optional reveal), practice sessions (answering)
// and results (answer vs key).
//   value: mcq → { choice: ["B"] }; numerical → { value, unit }; matching →
//   { pairs: { P: "1" } }; one_word / descriptive → { text }

function Option({ option, selected, multi, disabled, state, onClick }) {
  const tone =
    state === "correct" ? "border-success bg-success/10" : state === "wrong" ? "border-danger bg-danger/10" : selected ? "border-accent bg-accent-soft" : "border-line hover:bg-panel-2";
  return (
    <button type="button" disabled={disabled} onClick={onClick} aria-pressed={selected} className={`w-full flex items-start gap-3 p-3 rounded-xl border text-left transition-colors disabled:cursor-default ${tone}`}>
      <span className={`shrink-0 w-7 h-7 ${multi ? "rounded-md" : "rounded-full"} border flex items-center justify-center text-sm font-semibold ${selected ? "bg-accent text-accent-fg border-accent" : "border-line text-ink-2"}`}>
        {option.id}
      </span>
      <span className="pt-0.5 text-[15px] leading-6 min-w-0">
        <MathText text={option.text} />
      </span>
      {state === "correct" && <Icon name="check_circle" size={20} className="ml-auto text-success shrink-0" />}
      {state === "wrong" && <Icon name="cancel" size={20} className="ml-auto text-danger shrink-0" />}
    </button>
  );
}

export default function QuestionBody({ question: q, value, onChange, disabled = false, answerKey = null, onOpenCitation }) {
  const set = (patch) => onChange?.({ ...value, ...patch });
  const choice = value?.choice ?? [];
  const keyChoice = answerKey?.correct ?? [];

  return (
    <div className="flex flex-col gap-4">
      <Markdown text={q.stem} citations={q.citations} onOpenCitation={onOpenCitation} className="text-[16px]! leading-7!" />

      {(q.type === "mcq_single" || q.type === "mcq_multi") && (
        <div className="flex flex-col gap-2">
          {q.type === "mcq_multi" && <p className="text-xs text-ink-3">Choose all correct options.</p>}
          {q.options.map((o) => {
            const selected = choice.includes(o.id);
            const state = answerKey ? (keyChoice.includes(o.id) ? "correct" : selected ? "wrong" : null) : null;
            return (
              <Option
                key={o.id}
                option={o}
                multi={q.type === "mcq_multi"}
                selected={selected}
                state={state}
                disabled={disabled || !onChange}
                onClick={() => set({ choice: q.type === "mcq_multi" ? (selected ? choice.filter((c) => c !== o.id) : [...choice, o.id].sort()) : selected ? [] : [o.id] })}
              />
            );
          })}
        </div>
      )}

      {q.type === "numerical" && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            className="input w-44!"
            inputMode="decimal"
            placeholder="Your answer"
            aria-label="Numerical answer"
            value={value?.value ?? ""}
            disabled={disabled || !onChange}
            onChange={(e) => set({ value: e.target.value.slice(0, 30) })}
          />
          <input className="input w-28!" placeholder="Unit" aria-label="Unit" value={value?.unit ?? ""} disabled={disabled || !onChange} onChange={(e) => set({ unit: e.target.value.slice(0, 20) })} />
          {answerKey && (
            <span className="text-sm text-ink-2">
              Key: <b className="tabular-nums">{answerKey.value}</b> {answerKey.unit} {answerKey.tolerance ? <span className="text-ink-3">(± {answerKey.tolerance})</span> : null}
            </span>
          )}
        </div>
      )}

      {q.type === "matching" && (
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="flex flex-col gap-2">
            <p className="text-xs font-semibold text-ink-3">List-I</p>
            {q.options.left.map((x) => (
              <div key={x.id} className="flex items-center gap-2 p-2.5 rounded-xl border border-line">
                <span className="w-7 shrink-0 font-semibold text-sm">{x.id}</span>
                <span className="flex-1 min-w-0 text-sm">
                  <MathText text={x.text} />
                </span>
                <select
                  className="input w-20! py-1!"
                  aria-label={`Match for ${x.id}`}
                  value={value?.pairs?.[x.id] ?? ""}
                  disabled={disabled || !onChange}
                  onChange={(e) => set({ pairs: { ...value?.pairs, [x.id]: e.target.value } })}
                >
                  <option value="">—</option>
                  {q.options.right.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.id}
                    </option>
                  ))}
                </select>
                {answerKey && (
                  <span className={`text-xs font-semibold ${answerKey.pairs[x.id] === value?.pairs?.[x.id] ? "text-success" : "text-danger"}`}>→ {answerKey.pairs[x.id]}</span>
                )}
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-xs font-semibold text-ink-3">List-II</p>
            {q.options.right.map((r) => (
              <div key={r.id} className="flex items-center gap-2 p-2.5 rounded-xl bg-panel-2 text-sm">
                <span className="w-6 shrink-0 font-semibold">{r.id}</span>
                <MathText text={r.text} />
              </div>
            ))}
          </div>
        </div>
      )}

      {q.type === "one_word" && (
        <div className="flex flex-wrap items-center gap-2">
          <input className="input max-w-xs" placeholder="Your answer" aria-label="Answer" value={value?.text ?? ""} disabled={disabled || !onChange} onChange={(e) => set({ text: e.target.value.slice(0, 80) })} />
          {answerKey && (
            <span className="text-sm text-ink-2">
              Key: <b>{answerKey.text}</b>
            </span>
          )}
        </div>
      )}

      {q.type === "descriptive" && onChange && (
        <textarea
          className="input min-h-48 leading-6"
          placeholder="Write your answer…"
          aria-label="Your answer"
          value={value?.text ?? ""}
          disabled={disabled}
          maxLength={12000}
          onChange={(e) => set({ text: e.target.value })}
        />
      )}
    </div>
  );
}
