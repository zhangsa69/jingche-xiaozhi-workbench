import { useCallback, useMemo, useRef, useState } from "react";
import {
  matchPrompts,
  promptLibraryStatus,
  promptRecallHistory,
  recallPrompt,
  type PromptLibraryEntry,
} from "@pi-desktop/shared";
import {
  deletePrompt,
  loadPromptLibrary,
  rememberPromptText,
  togglePinnedPrompt,
  updatePromptTags,
} from "../lib/prompt-library-store";
import { useAppStore } from "../stores/app-store";

export type PromptLibraryController = {
  open: boolean;
  toggleOpen: () => void;
  close: () => void;
  entries: PromptLibraryEntry[];
  /** Filtered by the tag rail, then by the search box. */
  visible: PromptLibraryEntry[];
  status: ReturnType<typeof promptLibraryStatus>;
  query: string;
  setQuery: (query: string) => void;
  tagFilter: string | null;
  setTagFilter: (tag: string | null) => void;
  /** Called after a successful send; slash commands are ignored upstream. */
  remember: (text: string) => void;
  /** Append to the live draft through the store prefill channel. */
  insert: (text: string) => void;
  togglePin: (id: string) => void;
  saveTags: (id: string, tags: readonly string[]) => void;
  remove: (id: string) => void;
  /**
   * ArrowUp recall. Returns the text to put in the draft, or null to leave the
   * draft alone (nothing older, or the user edited what was recalled).
   */
  recall: (currentText: string) => string | null;
  resetRecall: () => void;
};

/**
 * One controller for the sheet and the arrow key, so both read the same list.
 * The recall anchor lives in a ref: it is bookkeeping between keystrokes, not
 * something the panel should re-render for.
 */
export function usePromptLibrary(): PromptLibraryController {
  const [entries, setEntries] = useState<PromptLibraryEntry[]>(() => loadPromptLibrary());
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const recallAnchor = useRef<string | null>(null);

  const status = useMemo(() => promptLibraryStatus(entries), [entries]);
  const visible = useMemo(() => {
    const byTag = tagFilter
      ? entries.filter((entry) =>
          entry.tags.some((tag) => tag.toLowerCase() === tagFilter.toLowerCase()),
        )
      : entries;
    return matchPrompts(byTag, query);
  }, [entries, query, tagFilter]);

  const close = useCallback(() => setOpen(false), []);
  const toggleOpen = useCallback(() => {
    setOpen((current) => !current);
    setQuery("");
  }, []);

  const remember = useCallback((text: string) => {
    recallAnchor.current = null;
    setEntries(rememberPromptText(text));
  }, []);

  const insert = useCallback((text: string) => {
    recallAnchor.current = null;
    setOpen(false);
    // The same channel the expert and template pages use: it reads the live
    // draft and appends, so anything already typed survives.
    useAppStore.getState().appendComposerDraftText(text);
  }, []);

  const togglePin = useCallback((id: string) => {
    setEntries((current) => togglePinnedPrompt(current, id));
  }, []);

  const saveTags = useCallback((id: string, tags: readonly string[]) => {
    setEntries((current) => updatePromptTags(current, id, tags));
  }, []);

  const remove = useCallback((id: string) => {
    setEntries((current) => deletePrompt(current, id));
  }, []);

  const resetRecall = useCallback(() => {
    recallAnchor.current = null;
  }, []);

  const recall = useCallback(
    (currentText: string) => {
      const history = promptRecallHistory(entries);
      const next = recallPrompt(history, {
        text: currentText,
        anchor: recallAnchor.current,
      });
      if (!next) return null;
      recallAnchor.current = next.anchor;
      return next.text;
    },
    [entries],
  );

  return {
    open,
    toggleOpen,
    close,
    entries,
    visible,
    status,
    query,
    setQuery,
    tagFilter,
    setTagFilter,
    remember,
    insert,
    togglePin,
    saveTags,
    remove,
    recall,
    resetRecall,
  };
}
