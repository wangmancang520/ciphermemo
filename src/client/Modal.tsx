import { useEffect, useLayoutEffect, useRef } from 'react';
import { useMotionSwitch } from './motion';
import { usePresence } from './MotionPresence';
import { X } from 'lucide-react';
import { t } from './preferences';
export default function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const active = usePresence();
  const activeRef = useRef(active);
  activeRef.current = active;
  const restore = useRef<HTMLElement | null>(null);
  useMotionSwitch(ref, 'dialog', 'dialog');
  useLayoutEffect(() => {
    if (!active && restore.current?.isConnected) restore.current.focus();
    else if (active && restore.current) ref.current?.focus();
  }, [active]);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const old = document.activeElement as HTMLElement | null;
    restore.current = old;
    ref.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (!activeRef.current) return;
      if (e.key === 'Escape') closeRef.current();
      if (e.key === 'Tab') {
        const items = ref.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]',
        );
        if (!items?.length) return;
        const first = items[0],
          last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      if (
        old?.isConnected &&
        (document.activeElement === document.body || ref.current?.contains(document.activeElement))
      )
        old.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="modal"
        ref={ref}
        tabIndex={-1}
      >
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-button" aria-label={t('关闭')} onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
