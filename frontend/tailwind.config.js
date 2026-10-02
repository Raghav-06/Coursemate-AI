/** @type {import('tailwindcss').Config} */

// Semantic colors resolve to CSS variables (see src/index.css) so light and
// dark themes swap by toggling the `dark` class on <html>.
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],

  darkMode: "class",

  theme: {
    extend: {
      colors: {
        bg: token("bg"),
        panel: token("panel"),
        "panel-2": token("panel-2"),
        "panel-3": token("panel-3"),
        line: token("line"),
        ink: token("ink"),
        "ink-2": token("ink-2"),
        "ink-3": token("ink-3"),
        accent: token("accent"),
        "accent-fg": token("accent-fg"),
        "accent-soft": token("accent-soft"),
        "accent-soft-fg": token("accent-soft-fg"),
        danger: token("danger"),
        success: token("success"),
        mark: token("mark"),
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        display: ["'Plus Jakarta Sans'", "Inter", "sans-serif"],
        mono: ["'JetBrains Mono'", "monospace"],
      },
      boxShadow: {
        pop: "0 8px 28px -6px rgb(0 0 0 / 0.25), 0 2px 6px rgb(0 0 0 / 0.08)",
      },
      keyframes: {
        "fade-in": { from: { opacity: 0, transform: "translateY(4px)" }, to: { opacity: 1, transform: "none" } },
        shimmer: { "0%": { backgroundPosition: "-200% 0" }, "100%": { backgroundPosition: "200% 0" } },
      },
      animation: {
        "fade-in": "fade-in 160ms ease-out",
        shimmer: "shimmer 1.6s linear infinite",
      },
    },
  },

  plugins: [],
};
