import { useCallback, useEffect, useState } from "react";

function readTheme() {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function useTheme() {
  const [theme, setTheme] = useState(readTheme);

  const toggle = useCallback(() => {
    const next = readTheme() === "dark" ? "light" : "dark";
    document.documentElement.classList.toggle("dark", next === "dark");
    try {
      localStorage.setItem("cm-theme", next);
    } catch {
      // storage unavailable — theme still applies for this session
    }
    setTheme(next);
  }, []);

  return [theme, toggle];
}

// Minimal hash router: "#/" is the notebook list, "#/notebook/<id>" a notebook.
export function useRoute() {
  const parse = () => {
    const match = window.location.hash.match(/^#\/notebook\/([^/?#]+)/);
    return match ? { page: "notebook", id: decodeURIComponent(match[1]) } : { page: "home" };
  };
  const [route, setRoute] = useState(parse);

  useEffect(() => {
    const onChange = () => setRoute(parse());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  return route;
}

export function navigate(path) {
  window.location.hash = path;
}

export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}
