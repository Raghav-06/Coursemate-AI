import { useEffect, useState } from "react";
import { useRoute } from "./hooks";
import { api } from "./api";
import { AuthProvider, useAuth } from "./auth";
import { Spinner, Toaster } from "./components/ui";
import HomePage from "./pages/HomePage";
import NotebookPage from "./pages/NotebookPage";
import LoginPage from "./pages/LoginPage";

function Banners({ health }) {
  if (health?.offline) {
    return (
      <div className="bg-danger text-white text-sm text-center px-4 py-2">
        Can't reach the Ask AI server. Start it with <code className="font-mono">cd backend &amp;&amp; npm start</code>, then reload.
      </div>
    );
  }
  if (health && !health.apiKeyConfigured) {
    return (
      <div className="bg-accent-soft text-accent-soft-fg text-sm text-center px-4 py-2">
        Add your <code className="font-mono">{health.apiKeyName}</code> in <code className="font-mono">backend/.env</code> and restart the
        server to enable sources and chat.
      </div>
    );
  }
  return null;
}

function Routes() {
  const route = useRoute();
  const { user, error } = useAuth();
  const [health, setHealth] = useState(null);

  useEffect(() => {
    api.health().then(setHealth, () => setHealth({ offline: true }));
  }, []);

  let page;
  if (user === undefined) {
    page = (
      <div className="h-full flex items-center justify-center text-ink-3">
        <Spinner className="w-6 h-6" />
      </div>
    );
  } else if (!user) {
    const serverError =
      error || (health && !health.offline && !health.googleAuthConfigured
        ? "Google sign-in isn't configured yet (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET in backend/.env). You can still sign in with email."
        : null);
    page = <LoginPage serverError={serverError} />;
  } else if (route.page === "notebook") {
    page = <NotebookPage key={route.id} notebookId={route.id} />;
  } else {
    page = <HomePage />;
  }

  return (
    <div className="h-full flex flex-col">
      <Banners health={user ? health : health?.offline ? health : null} />
      <div className="flex-1 min-h-0">{page}</div>
      <Toaster />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Routes />
    </AuthProvider>
  );
}
