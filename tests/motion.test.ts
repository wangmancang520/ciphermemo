import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { animateElement } from '../src/client/motion';

let reduced: boolean;
let listeners: Set<() => void>;
beforeEach(() => {
  reduced = false;
  listeners = new Set();
  vi.stubGlobal('window', {
    matchMedia: () => ({
      get matches() {
        return reduced;
      },
      addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    }),
  });
});
afterEach(() => vi.unstubAllGlobals());

function animation() {
  let resolve!: () => void;
  let reject!: (reason: Error) => void;
  const finished = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return {
    finished,
    cancel: vi.fn(() => reject(new Error('Animation cancelled'))),
    resolve,
  };
}
const frames = [{ opacity: 0 }, { opacity: 1 }];

describe('interruptible interface motion', () => {
  it('skips animations for reduced motion and unsupported browsers', async () => {
    const animate = vi.fn();
    reduced = true;
    await animateElement({ animate } as unknown as HTMLElement, frames).finished;
    expect(animate).not.toHaveBeenCalled();
    reduced = false;
    await animateElement({} as HTMLElement, frames).finished;
    await animateElement(null, frames).finished;
    expect(listeners.size).toBe(0);
  });

  it('cancels an earlier transition when users switch quickly, without cancelling its replacement', async () => {
    const first = animation(),
      second = animation();
    const element = {
      animate: vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second),
    } as unknown as HTMLElement;
    const old = animateElement(element, frames);
    const latest = animateElement(element, frames);
    await old.finished;
    expect(first.cancel).toHaveBeenCalledOnce();
    expect(second.cancel).not.toHaveBeenCalled();
    expect(listeners.size).toBe(1);
    second.resolve();
    await latest.finished;
    expect(listeners.size).toBe(0);
  });

  it('stops an active transition when the system enables reduced motion', async () => {
    const active = animation();
    const handle = animateElement({ animate: () => active } as unknown as HTMLElement, frames);
    reduced = true;
    for (const changed of [...listeners]) changed();
    await handle.finished;
    expect(active.cancel).toHaveBeenCalledOnce();
    expect(listeners.size).toBe(0);
  });

  it('releases subscriptions on unmount and tolerates unavailable animation APIs', async () => {
    const active = animation();
    const handle = animateElement({ animate: () => active } as unknown as HTMLElement, frames);
    handle.cancel();
    await handle.finished;
    expect(listeners.size).toBe(0);
    await expect(
      animateElement(
        {
          animate: () => {
            throw new Error('unsupported');
          },
        } as unknown as HTMLElement,
        frames,
      ).finished,
    ).resolves.toBeUndefined();
  });
});
