import { useState } from "react";
import { api } from "../../api";
import { navigate } from "../../hooks";
import { Icon, Modal, Spinner } from "../ui";

/** Enter a 6-character code to join a quiz battle in a course shared with you. Mount it when opened. */
export default function JoinBattleDialog({ open, onClose }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const join = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const battle = await api.joinBattle(code);
      onClose();
      navigate(`/battle/${battle.code}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Join a quiz battle" width="max-w-sm">
      <form onSubmit={join} className="flex flex-col gap-4">
        <p className="text-sm text-ink-2">Enter the code the host shared. You need to be in the battle's course.</p>
        <input
          className="input text-center font-mono text-2xl! tracking-[0.4em] uppercase"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))}
          placeholder="ABC123"
          aria-label="Battle code"
          autoComplete="off"
          autoFocus
        />
        {error && <p className="text-sm text-danger">{error}</p>}
        <button type="submit" className="btn-primary h-11" disabled={busy || code.length !== 6}>
          {busy ? <Spinner /> : <Icon name="sports_esports" size={20} />} Join
        </button>
      </form>
    </Modal>
  );
}
