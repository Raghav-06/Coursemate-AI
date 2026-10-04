import { useTheme, navigate } from "../hooks";
import { IconButton } from "./ui";

export function Logo({ compact = false }) {
  return (
    <button type="button" onClick={() => navigate("/")} className="flex items-center gap-2.5 rounded-full pr-2 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent/60" title="All notebooks">
      <img src="/favicon.svg" alt="" className="w-8 h-8" />
      {!compact && <span className="font-display text-[19px] font-semibold tracking-tight text-ink">CourseMate AI</span>}
    </button>
  );
}

export function ThemeToggle() {
  const [theme, toggle] = useTheme();
  return <IconButton icon={theme === "dark" ? "light_mode" : "dark_mode"} label={theme === "dark" ? "Light mode" : "Dark mode"} onClick={toggle} />;
}
