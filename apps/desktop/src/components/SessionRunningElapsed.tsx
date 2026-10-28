import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { formatToolDuration } from "../lib/tool-display";

/**
 * W-09: how long the session at hand has been working.
 *
 * The component only exists while its row is running, so mounting is the
 * start of the turn and unmounting cleans the timer. Ticking inside this span
 * keeps the sidebar from re-rendering hundreds of rows every second.
 */
export function SessionRunningElapsed() {
  const { t } = useTranslation();
  const startedAtRef = useRef(Date.now());
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const seconds = Math.max(0, Math.floor((now - startedAtRef.current) / 1000));
  const label = t("nav.sessionRunningFor", {
    time: formatToolDuration(seconds),
    defaultValue: "Running {{time}}",
  });

  return (
    <span className="thread-item-elapsed" title={label} aria-label={label}>
      {formatToolDuration(seconds)}
    </span>
  );
}
