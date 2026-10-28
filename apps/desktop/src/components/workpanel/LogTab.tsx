import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  LogTailChannel,
  LogTailLevel,
  LogTailRecord,
} from "@pi-desktop/shared";
import { api } from "../../lib/api";
import {
  LOG_LEVELS,
  filterLogRecords,
  formatLogTime,
  logLevelCounts,
} from "../../lib/log-filter";
import { IconTerminal } from "../icons";
import { WorkTabEmpty } from "./WorkTabEmpty";

const CHANNELS: readonly LogTailChannel[] = ["app", "host", "agent"];
const POLL_MS = 2000;
const ROW_LIMIT = 300;

/**
 * The app's own log file, read through the same NDJSON the logger writes (W-17).
 *
 * Polling instead of pushing: the log file is written by a separate process for
 * the host channel, so a subscription would still have to poll a file, only
 * through more machinery. Two seconds is faster than a person can read.
 */
export function LogTab() {
  const { t } = useTranslation();
  const [channel, setChannel] = useState<LogTailChannel>("app");
  const [level, setLevel] = useState<LogTailLevel | "all">("info");
  const [query, setQuery] = useState("");
  const [follow, setFollow] = useState(true);
  const [records, setRecords] = useState<LogTailRecord[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const listRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await api.logTail({
        channel,
        ...(level === "all" ? {} : { level }),
        limit: ROW_LIMIT,
      });
      setRecords(result.records);
      setTruncated(result.truncated);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [channel, level]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  useEffect(() => {
    if (!follow) return;
    const timer = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [follow, load]);

  const visible = useMemo(
    () => filterLogRecords(records, { level, query }),
    [records, level, query],
  );
  const counts = useMemo(() => logLevelCounts(records), [records]);

  useEffect(() => {
    if (!follow) return;
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [follow, visible]);

  if (!loading && !failed && records.length === 0) {
    return (
      <WorkTabEmpty
        icon={IconTerminal}
        title={t("panel.log.empty")}
        body={t("panel.log.emptyHint")}
      />
    );
  }

  return (
    <div className="log-tab">
      <div className="log-toolbar">
        <select
          className="log-select"
          value={channel}
          onChange={(event) => setChannel(event.target.value as LogTailChannel)}
          aria-label={t("panel.log.channel")}
        >
          {CHANNELS.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <select
          className="log-select"
          value={level}
          onChange={(event) =>
            setLevel(event.target.value as LogTailLevel | "all")
          }
          aria-label={t("panel.log.level")}
        >
          {LOG_LEVELS.map((value) => (
            <option key={value} value={value}>
              {value === "all" ? t("panel.log.all") : value}
            </option>
          ))}
        </select>
        <input
          className="log-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("panel.log.search")}
          aria-label={t("panel.log.search")}
        />
        <button
          type="button"
          className="log-follow"
          aria-pressed={follow}
          onClick={() => setFollow((value) => !value)}
        >
          {t("panel.log.follow")}
        </button>
        <span className="log-count">
          {t("panel.log.count", { count: visible.length })}
        </span>
      </div>

      {truncated ? <p className="log-notice">{t("panel.log.truncated")}</p> : null}
      {failed ? <p className="log-notice is-error">{t("panel.log.error")}</p> : null}

      <div className="log-list" ref={listRef}>
        {visible.map((record) => (
          <div
            className="log-row"
            key={`${record.ts}-${record.channel}-${record.category}-${record.event}`}
          >
            <span className="log-time">{formatLogTime(record.ts)}</span>
            <span className={`log-level is-${record.level}`}>{record.level}</span>
            <span className="log-event">{record.event || record.category}</span>
            <span className="log-message">{record.message}</span>
            {record.data === undefined ? null : (
              <details className="log-data">
                <summary>{t("panel.log.details")}</summary>
                <pre>{JSON.stringify(record.data, null, 2)}</pre>
              </details>
            )}
          </div>
        ))}
      </div>

      <p className="log-legend">
        <span>{t("panel.log.counts", counts)}</span>
      </p>
    </div>
  );
}
