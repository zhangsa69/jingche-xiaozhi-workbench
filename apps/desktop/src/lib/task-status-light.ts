/**
 * The top bar's three-lens task lamp.
 *
 * The lamp is a status device, not a control: exactly one lens is lit and the
 * other two stay dark. Ordering matters because the signals overlap — a turn
 * that is parked on a permission prompt is still "running" in the session
 * record, but the user is the blocker there, so that lens wins.
 */
export type TaskStatusLamp = "idle" | "running" | "permission" | "failed";

/** Lens order in the bezel, left to right: stop / attention / go. */
export const TASK_STATUS_LENSES = ["red", "amber", "green"] as const;
export type TaskStatusLens = (typeof TASK_STATUS_LENSES)[number];

/** Which lens a state lights. */
export const TASK_STATUS_LENS: Record<TaskStatusLamp, TaskStatusLens> = {
  failed: "red",
  idle: "green",
  permission: "amber",
  running: "amber",
};

export function taskStatusLamp({
  running,
  hasPendingPermission,
  failed,
}: {
  running: boolean;
  hasPendingPermission?: boolean;
  failed?: boolean;
}): TaskStatusLamp {
  if (hasPendingPermission) return "permission";
  if (running) return "running";
  if (failed) return "failed";
  return "idle";
}
