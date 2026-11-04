// The assistant answers under the product's own face. `avatar.png` is a
// renderer-sized copy of the canonical app tile emitted by
// `scripts/make-icon.py`; the installer icons in `build/` stay out of the
// renderer (D221), the same split `BrandLogo` uses for the wordmark.
import avatarUrl from "../../../assets/brand/avatar.png";

/**
 * Decorative marker, not content: the row already carries the assistant label,
 * so the tile is hidden from assistive tech and never announced per turn.
 */
export function AssistantAvatar() {
  return (
    <img
      className="assistant-avatar"
      src={avatarUrl}
      alt=""
      aria-hidden="true"
      width={28}
      height={28}
      draggable={false}
    />
  );
}
