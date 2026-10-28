/** Shared public types grouped by the owning application domain. */

/**
 * Operating states of a session (W-01).
 *
 * - `read-only` answers questions without touching the workspace: the host
 *   hard-denies every write tool, so the promise holds even under `auto`.
 * - `plan` and `goal` negotiate a contract before executing (D198).
 * - `agent` is the executing mode.
 *
 * The wire value is `read-only` rather than `ask` because `PermissionMode`
 * already owns `ask` (prompt me each time); two different `ask` meanings in one
 * protocol invite exactly the mix-up that costs a write to the wrong mode.
 */
export type Mode = "read-only" | "plan" | "goal" | "agent";

/** Normalize mode values at compatibility boundaries. Older persisted and
 * scheduled data used `chat`; it is now the Plan operating state. */
export function normalizeMode(value: unknown, fallback: Mode = "agent"): Mode {
  if (value === "agent") return "agent";
  if (value === "goal") return "goal";
  if (value === "plan" || value === "chat") return "plan";
  // `ask` was the pre-release name for the read-only mode; keep it working so
  // drafts and rows written before the rename still mean what they meant.
  if (value === "read-only" || value === "ask") return "read-only";
  return fallback;
}

/** Modes that must never write to the workspace, whatever the permission mode. */
export function isReadOnlyMode(mode: unknown): boolean {
  return normalizeMode(mode) === "read-only";
}
