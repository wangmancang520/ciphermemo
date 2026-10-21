import {
  createContext,
  isValidElement,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { animateElement } from './motion';

const Presence = createContext(true);
export const usePresence = () => useContext(Presence);

/** Keeps an ordinary dialog mounted briefly for its exit; auth changes unmount it immediately. */
export default function MotionPresence({ children }: { children: ReactNode }) {
  const visible = isValidElement(children);
  const latest = useRef<ReactElement | null>(null);
  const [present, setPresent] = useState(visible);
  const ref = useRef<HTMLDivElement>(null);
  if (visible) latest.current = children;
  useLayoutEffect(() => {
    let current = true;
    if (visible) setPresent(true);
    const root = animateElement(
      ref.current,
      visible ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 1 }, { opacity: 0 }],
      { duration: visible ? 180 : 150 },
    );
    const panel = !visible
      ? animateElement(
          ref.current?.querySelector<HTMLElement>('.modal') ?? null,
          [{ transform: 'translateY(0) scale(1)' }, { transform: 'translateY(8px) scale(.985)' }],
          { duration: 150 },
        )
      : null;
    if (!visible)
      void root.finished.then(() => {
        if (current) {
          latest.current = null;
          setPresent(false);
        }
      });
    return () => {
      current = false;
      root.cancel();
      panel?.cancel();
    };
  }, [visible]);
  if (!visible && !present) return null;
  return (
    <Presence value={visible}>
      <div
        ref={ref}
        className="motion-presence"
        data-exiting={!visible || undefined}
        inert={!visible}
        aria-hidden={!visible || undefined}
      >
        {visible ? children : latest.current}
      </div>
    </Presence>
  );
}
