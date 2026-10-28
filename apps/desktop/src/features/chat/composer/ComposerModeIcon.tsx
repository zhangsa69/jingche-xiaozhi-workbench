import type { Mode } from "@pi-desktop/shared";
import {
  IconChat,
  IconListChecks,
  IconShield,
  IconTarget,
} from "../../../components/icons";

export function ModeIcon({ mode }: { mode: Mode }) {
  if (mode === "read-only") return <IconChat size={14} />;
  if (mode === "plan") return <IconListChecks size={14} />;
  if (mode === "goal") return <IconTarget size={14} />;
  return <IconShield size={14} />;
}
