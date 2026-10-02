import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export function Icon({ name, className = "", filled = false, size }) {
  return (
    <span
      className={`material-symbols-outlined ${filled ? "filled" : ""} ${className}`}
      style={size ? { fontSize: size } : undefined}
      aria-hidden="true"
    >
      {name}
    </span>
  );
}

export function Spinner({ className = "w-4 h-4" }) {
  return (
    <span
      className={`inline-block rounded-full border-2 border-current border-r-transparent animate-spin ${className}`}
      role="status"
      aria-label="Loading"
    />
  );
}

export function IconButton({ icon, label, onClick, className = "", filled, disabled, size }) {
  return (
    <button type="button" className={`icon-btn ${className}`} onClick={onClick} title={label} aria-label={label} disabled={disabled}>
      <Icon name={icon} filled={filled} size={size ?? 20} />
    </button>
  );
}

export function Modal({ open, onClose, title, children, footer, width = "max-w-lg", bodyClassName = "p-6" }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onClose?.();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 animate-fade-in" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div role="dialog" aria-modal="true" className={`w-full ${width} max-h-[90vh] flex flex-col bg-panel text-ink rounded-3xl shadow-pop overflow-hidden`}>
        {title !== undefined && (
          <div className="flex items-center justify-between gap-4 px-6 pt-5 pb-3">
            <h2 className="font-display text-lg font-semibold min-w-0 truncate">{title}</h2>
            <IconButton icon="close" label="Close" onClick={onClose} />
          </div>
        )}
        <div className={`flex-1 overflow-y-auto scroll-thin ${bodyClassName}`}>{children}</div>
        {footer && <div className="flex justify-end gap-2 px-6 py-4 border-t border-line/60">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}

export function ConfirmDialog({ open, title, message, confirmLabel = "Delete", onConfirm, onClose }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      width="max-w-md"
      bodyClassName="px-6 pb-2 text-sm text-ink-2"
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn bg-danger text-white hover:bg-danger/90"
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      {message}
    </Modal>
  );
}

/**
 * Kebab-style dropdown. `items`: [{ label, icon, onClick, danger }] (null
 * entries are skipped). Rendered in a portal so panels don't clip it.
 */
export function Menu({ items, icon = "more_vert", label = "More options", buttonClassName = "", align = "right" }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState(null);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);

  useLayoutEffect(() => {
    if (!open) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const menuHeight = menuRef.current?.offsetHeight ?? 0;
    const top = rect.bottom + 4 + menuHeight > window.innerHeight ? rect.top - menuHeight - 4 : rect.bottom + 4;
    setPosition(align === "right" ? { top, right: window.innerWidth - rect.right } : { top, left: rect.left });
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    const close = (e) => {
      if (!menuRef.current?.contains(e.target) && !buttonRef.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    const onResize = () => setOpen(false);
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`icon-btn ${buttonClassName}`}
        aria-label={label}
        title={label}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        <Icon name={icon} size={20} />
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{ position: "fixed", ...(position ?? { top: -9999, left: -9999 }) }}
            className="z-[60] min-w-[200px] py-1.5 rounded-xl bg-panel-2 border border-line shadow-pop animate-fade-in"
          >
            {items.filter(Boolean).map((item) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                className={`w-full flex items-center gap-3 px-4 py-2 text-sm text-left hover:bg-panel-3 ${item.danger ? "text-danger" : "text-ink"}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(false);
                  item.onClick();
                }}
              >
                {item.icon && <Icon name={item.icon} size={18} />}
                {item.label}
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}

// Simple global toast: call toast("message") from anywhere.
const listeners = new Set();
export function toast(message, tone = "info") {
  const item = { id: Math.random(), message, tone };
  listeners.forEach((fn) => fn(item));
}

export function Toaster() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    const add = (item) => {
      setItems((list) => [...list, item]);
      setTimeout(() => setItems((list) => list.filter((i) => i.id !== item.id)), 4500);
    };
    listeners.add(add);
    return () => listeners.delete(add);
  }, []);

  return createPortal(
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[70] flex flex-col items-center gap-2 pointer-events-none">
      {items.map((item) => (
        <div
          key={item.id}
          className={`pointer-events-auto max-w-md px-4 py-3 rounded-xl shadow-pop text-sm animate-fade-in ${
            item.tone === "error" ? "bg-danger text-white" : "bg-ink text-bg"
          }`}
        >
          {item.message}
        </div>
      ))}
    </div>,
    document.body
  );
}

export function Checkbox({ checked, indeterminate, onChange, label }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = Boolean(indeterminate);
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label={label}
      title={label}
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      onClick={(e) => e.stopPropagation()}
      className="w-[18px] h-[18px] shrink-0 accent-[rgb(var(--accent))] cursor-pointer"
    />
  );
}

export function copyText(text) {
  navigator.clipboard?.writeText(text).then(
    () => toast("Copied to clipboard"),
    () => toast("Couldn't copy to clipboard", "error")
  );
}

export function downloadText(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}

export function timeAgo(iso) {
  const date = new Date(iso);
  const seconds = (Date.now() - date) / 1000;
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
