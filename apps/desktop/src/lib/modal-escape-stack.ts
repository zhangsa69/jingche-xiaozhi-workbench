/**
 * Escape arrives as a `window` keydown, so every mounted dialog hears it at the
 * same moment and a plain `event.key === "Escape"` check closes the whole stack
 * at once. Dialogs claim a layer when they mount and only the newest owner
 * reacts, which is what "Esc closes the dialog I am looking at" means.
 *
 * `stopPropagation` cannot replace this: all the listeners sit on the same
 * target, and the newest one is registered last, so it would run after the
 * dialog underneath had already closed.
 */
const layers: symbol[] = [];

export type EscapeLayer = {
  /** True while this dialog is the one on top of the stack. */
  isTop: () => boolean;
  /** Idempotent, so a re-run effect cannot leave a stale claim behind. */
  release: () => void;
};

export function claimEscapeLayer(): EscapeLayer {
  const token = Symbol("escape-layer");
  layers.push(token);
  return {
    isTop: () => layers[layers.length - 1] === token,
    release: () => {
      const index = layers.lastIndexOf(token);
      if (index !== -1) layers.splice(index, 1);
    },
  };
}
