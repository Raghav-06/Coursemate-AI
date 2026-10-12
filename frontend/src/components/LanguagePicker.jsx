/**
 * Response-language select + "bilingual" switch. `languages` come from the
 * server ([{ code, name, native }]); `inheritLabel` adds a "use my default"
 * option (value null), for per-course settings.
 */
export default function LanguagePicker({ languages, language, bilingual, onChange, inheritLabel }) {
  return (
    <div className="flex flex-col gap-3">
      <select
        className="input"
        value={language ?? ""}
        onChange={(e) => onChange({ language: e.target.value || null, bilingual: e.target.value === "en" ? false : bilingual })}
        aria-label="Response language"
      >
        {inheritLabel && <option value="">{inheritLabel}</option>}
        {languages.map((l) => (
          <option key={l.code} value={l.code}>
            {l.code === "en" ? "English" : `${l.name} — ${l.native}`}
          </option>
        ))}
      </select>
      {language && language !== "en" && (
        <label className="flex items-start gap-3 text-sm cursor-pointer">
          <input type="checkbox" className="mt-0.5 w-4 h-4 accent-[rgb(var(--accent))]" checked={bilingual} onChange={(e) => onChange({ language, bilingual: e.target.checked })} />
          <span>
            <span className="font-medium">Bilingual</span>
            <span className="block text-xs text-ink-3">Explanations in your language, technical terms in English — handy when your textbooks and exams are in English.</span>
          </span>
        </label>
      )}
      {language && language !== "en" && <p className="text-xs text-ink-3">Formulas, symbols and citations stay as they are in your sources.</p>}
    </div>
  );
}
