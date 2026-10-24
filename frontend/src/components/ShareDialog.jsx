import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { navigate } from "../hooks";
import { ConfirmDialog, Icon, IconButton, Modal, Segmented, Spinner } from "./ui";
import { useAuth } from "../authContext";
import { copyText, toast } from "./uiUtils";

const ROLE_LABELS = { owner: "Owner", editor: "Editor", viewer: "Viewer" };
const ROLE_HELP = {
  editor: "Editors add and change sources, units and decks.",
  viewer: "Viewers read, chat and practise. Their chats, flashcard progress, quizzes and plans stay private.",
};

function Avatar({ member }) {
  const initial = (member.name || member.email || "?").trim()[0]?.toUpperCase();
  return member.avatarUrl ? (
    <img src={member.avatarUrl} alt="" className="w-8 h-8 rounded-full shrink-0" referrerPolicy="no-referrer" />
  ) : (
    <span className="w-8 h-8 rounded-full shrink-0 bg-accent-soft text-accent-soft-fg flex items-center justify-center text-sm font-semibold">{initial}</span>
  );
}

/**
 * Who's in a course. The owner invites people by email (an existing account
 * is added at once; anyone else gets a link that works when they sign up),
 * changes roles and removes people; everyone else can see the list and leave.
 * Mount it when opened.
 */
export default function ShareDialog({ notebook, open, onClose }) {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("viewer");
  const [busy, setBusy] = useState(false);
  const [lastLink, setLastLink] = useState(null); // { email, link } when no email went out
  const [removing, setRemoving] = useState(null);
  const [leaving, setLeaving] = useState(false);
  const owner = notebook.role === "owner";

  const load = useCallback(() => {
    api.listMembers(notebook.id).then(
      (d) => {
        setData(d);
        setError(null);
      },
      (err) => setError(err.message)
    );
  }, [notebook.id]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const invite = async (e) => {
    e.preventDefault();
    const address = email.trim();
    if (!address) return;
    setBusy(true);
    try {
      const result = await api.inviteMember(notebook.id, address, role);
      setEmail("");
      if (result.member) toast(`${result.member.name || result.member.email} can now ${role === "editor" ? "edit" : "view"} this course.`);
      else if (result.emailed) toast(`Invite emailed to ${result.invite.email}.`);
      if (result.invite && !result.emailed) setLastLink({ email: result.invite.email, link: result.link });
      load();
    } catch (err) {
      toast(err.message, "error");
    } finally {
      setBusy(false);
    }
  };

  const changeRole = async (member, next) => {
    try {
      await api.setMemberRole(notebook.id, member.userId, next);
      load();
    } catch (err) {
      toast(err.message, "error");
    }
  };

  const revoke = async (invite) => {
    try {
      await api.revokeInvite(notebook.id, invite.id);
      if (lastLink?.email === invite.email) setLastLink(null);
      load();
    } catch (err) {
      toast(err.message, "error");
    }
  };

  const remove = async () => {
    try {
      await api.removeMember(notebook.id, removing.userId);
      load();
    } catch (err) {
      toast(err.message, "error");
    }
  };

  const leave = async () => {
    try {
      await api.leaveCourse(notebook.id);
      toast(`You left "${notebook.title}".`);
      navigate("/");
    } catch (err) {
      toast(err.message, "error");
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={owner ? `Share "${notebook.title}"` : "People in this course"} width="max-w-xl">
      <div className="flex flex-col gap-5">
        {owner && (
          <form onSubmit={invite} className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-2">
              <input
                type="email"
                className="input flex-1 min-w-[200px]"
                placeholder="Classmate's email"
                maxLength={254}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-label="Email address to invite"
                autoFocus
              />
              <Segmented
                label="Role"
                value={role}
                onChange={setRole}
                options={[
                  ["viewer", "Viewer"],
                  ["editor", "Editor"],
                ]}
              />
              <button type="submit" className="btn-primary" disabled={busy || !email.trim()}>
                {busy ? <Spinner /> : <Icon name="person_add" size={18} />} Invite
              </button>
            </div>
            <p className="text-xs text-ink-3 leading-5">{ROLE_HELP[role]}</p>
          </form>
        )}

        {lastLink && (
          <div className="rounded-2xl bg-accent-soft/50 border border-accent/20 p-3 flex flex-col gap-2">
            <p className="text-sm text-ink-2">
              No email was sent (email isn't set up on the server). Send this link to <strong className="font-medium">{lastLink.email}</strong> — it works once they sign
              up or sign in with that address.
            </p>
            <div className="flex gap-2">
              <input className="input flex-1 font-mono text-xs!" readOnly value={lastLink.link} onFocus={(e) => e.target.select()} aria-label="Invite link" />
              <button type="button" className="btn-outline" onClick={() => copyText(lastLink.link)}>
                <Icon name="content_copy" size={18} /> Copy
              </button>
            </div>
          </div>
        )}

        {error && <p className="text-sm text-danger">{error}</p>}
        {!data && !error && (
          <div className="flex justify-center py-6 text-ink-3">
            <Spinner className="w-5 h-5" />
          </div>
        )}

        {data && (
          <div className="flex flex-col gap-1">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-3 mb-1">
              {data.members.length} {data.members.length === 1 ? "person" : "people"}
            </h3>
            {data.members.map((m) => (
              <div key={m.userId} className="flex items-center gap-3 py-1.5">
                <Avatar member={m} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-ink truncate">
                    {m.name || m.email}
                    {m.userId === user?.id && <span className="text-ink-3"> (you)</span>}
                  </p>
                  {m.name && <p className="text-xs text-ink-3 truncate">{m.email}</p>}
                </div>
                {owner && m.role !== "owner" ? (
                  <>
                    <select
                      className="input w-auto! py-1! text-sm"
                      value={m.role}
                      onChange={(e) => changeRole(m, e.target.value)}
                      aria-label={`Role of ${m.name || m.email}`}
                    >
                      <option value="editor">Editor</option>
                      <option value="viewer">Viewer</option>
                    </select>
                    <IconButton icon="person_remove" label={`Remove ${m.name || m.email}`} onClick={() => setRemoving(m)} />
                  </>
                ) : (
                  <span className="text-xs font-medium text-ink-3 px-2">{ROLE_LABELS[m.role]}</span>
                )}
              </div>
            ))}

            {owner && data.invites.length > 0 && (
              <>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-3 mt-4 mb-1">Invited — waiting to sign up</h3>
                {data.invites.map((inv) => (
                  <div key={inv.id} className="flex items-center gap-3 py-1.5">
                    <span className="w-8 h-8 rounded-full shrink-0 border border-dashed border-line flex items-center justify-center text-ink-3">
                      <Icon name="schedule_send" size={16} />
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-ink truncate">{inv.email}</p>
                      <p className="text-xs text-ink-3">
                        {ROLE_LABELS[inv.role]} · expires {new Date(inv.expiresAt).toLocaleDateString()}
                      </p>
                    </div>
                    <IconButton icon="close" label={`Cancel the invite to ${inv.email}`} onClick={() => revoke(inv)} />
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {!owner && (
          <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
            <p className="text-xs text-ink-3">You're {notebook.role === "editor" ? "an editor" : "a viewer"} of this course.</p>
            <button type="button" className="btn-outline text-danger!" onClick={() => setLeaving(true)}>
              <Icon name="logout" size={18} /> Leave course
            </button>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(removing)}
        title="Remove from course?"
        message={removing ? `${removing.name || removing.email} will lose access to "${notebook.title}". Their own progress is kept in case you add them again.` : ""}
        confirmLabel="Remove"
        onConfirm={remove}
        onClose={() => setRemoving(null)}
      />
      <ConfirmDialog
        open={leaving}
        title="Leave this course?"
        message={`You'll lose access to "${notebook.title}" until the owner invites you again.`}
        confirmLabel="Leave"
        onConfirm={leave}
        onClose={() => setLeaving(false)}
      />
    </Modal>
  );
}
