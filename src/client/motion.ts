import { useLayoutEffect, type RefObject } from 'react';

export type MotionHandle = { finished: Promise<void>; cancel: () => void };
const running = new WeakMap<HTMLElement, MotionHandle>();
const still = (): MotionHandle => ({ finished: Promise.resolve(), cancel: () => {} });
export const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Scoped DOM animations: no snapshots, clones, or remounting editor state. */
export function animateElement(
  element: HTMLElement | null,
  frames: Keyframe[],
  options: KeyframeAnimationOptions = {},
): MotionHandle {
  if (!element) return still();
  running.get(element)?.cancel();
  if (prefersReducedMotion() || typeof element.animate !== 'function') return still();
  const preference = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  let animation: Animation;
  try {
    animation = element.animate(frames, {
      duration: 220,
      easing: 'cubic-bezier(.2,.7,.2,1)',
      fill: 'backwards',
      ...options,
    });
  } catch {
    return still();
  }
  const cleanup = () => {
    preference?.removeEventListener('change', changed);
    if (running.get(element) === handle) running.delete(element);
  };
  const cancel = () => {
    animation.cancel();
    cleanup();
  };
  const changed = () => {
    if (preference?.matches) cancel();
  };
  const handle: MotionHandle = {
    cancel,
    finished: animation.finished
      .then(
        () => {},
        () => {},
      )
      .finally(cleanup),
  };
  running.set(element, handle);
  preference?.addEventListener('change', changed);
  return handle;
}

/** Animate only the visual container; children retain their React identity. */
export function useMotionSwitch(
  ref: RefObject<HTMLElement | null>,
  key: unknown,
  kind: 'content' | 'list' | 'dialog' = 'content',
) {
  useLayoutEffect(() => {
    const element = ref.current;
    const handles: MotionHandle[] = [];
    if (kind === 'list' && element) {
      handles.push(animateElement(element, [{ opacity: 0.6 }, { opacity: 1 }], { duration: 170 }));
      for (const [index, card] of Array.from(element.querySelectorAll<HTMLElement>('.note-card'))
        .slice(0, 8)
        .entries()) {
        handles.push(
          animateElement(
            card,
            [
              { opacity: 0, transform: 'translateY(8px)' },
              { opacity: 1, transform: 'translateY(0)' },
            ],
            { duration: 220, delay: index * 18 },
          ),
        );
      }
    } else {
      handles.push(
        animateElement(
          element,
          kind === 'dialog'
            ? [
                { transform: 'translateY(12px) scale(.98)' },
                { transform: 'translateY(0) scale(1)' },
              ]
            : [
                { opacity: 0.25, transform: 'translateY(7px)' },
                { opacity: 1, transform: 'translateY(0)' },
              ],
          { duration: kind === 'dialog' ? 230 : 190 },
        ),
      );
    }
    return () => handles.forEach((handle) => handle.cancel());
  }, [ref, key, kind]);
}
