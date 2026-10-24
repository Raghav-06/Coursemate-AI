/** Seconds as "1m 05s" / "42s" ("—" when unknown). */
export const fmtTime = (s) => {
  if (s === null || s === undefined) return "—";
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return m ? `${m}m ${String(r).padStart(2, "0")}s` : `${r}s`;
};
