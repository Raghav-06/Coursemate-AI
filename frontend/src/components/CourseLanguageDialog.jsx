import { useEffect, useState } from "react";
import { api } from "../api";
import LanguagePicker from "./LanguagePicker";
import { Modal, Spinner, toast } from "./ui";

/** This course's response language for the signed-in user (or their default). */
export default function CourseLanguageDialog({ notebookId, open, onClose }) {
  const [prefs, setPrefs] = useState(null);
  const [languages, setLanguages] = useState([]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    Promise.all([api.getCoursePreferences(notebookId), api.getSettings()]).then(
      ([p, s]) => {
        if (cancelled) return;
        setPrefs(p);
        setLanguages(s.languages);
      },
      (err) => toast(err.message, "error")
    );
    return () => {
      cancelled = true;
    };
  }, [open, notebookId]);

  const change = async (next) => {
    try {
      setPrefs(await api.updateCoursePreferences(notebookId, next));
    } catch (err) {
      toast(err.message, "error");
    }
  };

  const defaultName = prefs && !prefs.language ? prefs.effective : null;
  return (
    <Modal open={open} onClose={onClose} title="Language for this course" width="max-w-md" bodyClassName="px-6 pb-6">
      {!prefs ? (
        <Spinner className="w-5 h-5 text-ink-3" />
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-ink-2">Answers, flashcards, quizzes and feedback in this course use this language. Only you see this setting.</p>
          <LanguagePicker
            languages={languages}
            language={prefs.language}
            bilingual={prefs.bilingual}
            onChange={change}
            inheritLabel={`Use my default${defaultName ? ` (${defaultName.name}${defaultName.bilingual ? ", bilingual" : ""})` : ""}`}
          />
        </div>
      )}
    </Modal>
  );
}
