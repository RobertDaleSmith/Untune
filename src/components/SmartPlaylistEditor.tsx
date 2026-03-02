import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createSmartPlaylist,
  updateSmartPlaylist,
} from "../lib/commands";
import type { Playlist, RuleEntry, SmartPlaylistRules } from "../lib/types";

// ── Field metadata ──────────────────────────────────────────────

const FIELD_LABELS: Record<string, string> = {
  title: "Title",
  artist: "Artist",
  album: "Album",
  genre: "Genre",
  composer: "Composer",
  comments: "Comments",
  grouping: "Grouping",
  album_artist: "Album Artist",
  year: "Year",
  play_count: "Play Count",
  skip_count: "Skip Count",
  rating: "Rating",
  duration: "Duration",
  date_added: "Date Added",
  last_played_at: "Last Played",
  last_skipped_at: "Last Skipped",
  loved: "Loved",
  track_number: "Track #",
  disc_number: "Disc #",
  bit_rate: "Bit Rate",
  sample_rate: "Sample Rate",
  size: "Size",
  mood: "Mood",
  energy: "Energy",
  bpm: "BPM",
  danceability: "Danceability",
  acousticness: "Acousticness",
  vibe_tags: "Vibe Tags",
};

const FIELD_GROUPS: { label: string; fields: string[] }[] = [
  {
    label: "Text",
    fields: [
      "title",
      "artist",
      "album_artist",
      "album",
      "genre",
      "composer",
      "comments",
      "grouping",
    ],
  },
  {
    label: "Numeric",
    fields: [
      "year",
      "track_number",
      "disc_number",
      "duration",
      "size",
      "bit_rate",
      "sample_rate",
      "play_count",
      "skip_count",
      "rating",
    ],
  },
  {
    label: "AI Tags",
    fields: ["mood", "vibe_tags", "energy", "bpm", "danceability", "acousticness"],
  },
  { label: "Date", fields: ["date_added", "last_played_at", "last_skipped_at"] },
  { label: "Boolean", fields: ["loved"] },
];

type FieldType = "text" | "numeric" | "date" | "boolean";

function getFieldType(field: string): FieldType {
  if (
    [
      "title",
      "artist",
      "album_artist",
      "album",
      "genre",
      "composer",
      "comments",
      "grouping",
      "mood",
      "vibe_tags",
    ].includes(field)
  )
    return "text";
  if (
    [
      "year",
      "track_number",
      "disc_number",
      "duration",
      "size",
      "bit_rate",
      "sample_rate",
      "play_count",
      "skip_count",
      "rating",
      "energy",
      "bpm",
      "danceability",
      "acousticness",
    ].includes(field)
  )
    return "numeric";
  if (["date_added", "last_played_at", "last_skipped_at"].includes(field))
    return "date";
  return "boolean";
}

const OPS_BY_TYPE: Record<FieldType, { value: string; label: string }[]> = {
  text: [
    { value: "is", label: "is" },
    { value: "is_not", label: "is not" },
    { value: "contains", label: "contains" },
    { value: "not_contains", label: "does not contain" },
    { value: "starts_with", label: "starts with" },
    { value: "ends_with", label: "ends with" },
    { value: "is_set", label: "is set" },
    { value: "is_not_set", label: "is not set" },
  ],
  numeric: [
    { value: "eq", label: "=" },
    { value: "neq", label: "!=" },
    { value: "gt", label: ">" },
    { value: "gte", label: ">=" },
    { value: "lt", label: "<" },
    { value: "lte", label: "<=" },
    { value: "between", label: "between" },
    { value: "is_set", label: "is set" },
    { value: "is_not_set", label: "is not set" },
  ],
  date: [
    { value: "in_last", label: "in last" },
    { value: "not_in_last", label: "not in last" },
    { value: "before", label: "before" },
    { value: "after", label: "after" },
    { value: "is_set", label: "is set" },
    { value: "is_not_set", label: "is not set" },
  ],
  boolean: [
    { value: "is_true", label: "is true" },
    { value: "is_false", label: "is false" },
  ],
};

const SORT_OPTIONS = [
  { value: "random", label: "Random" },
  { value: "title", label: "Title" },
  { value: "artist", label: "Artist" },
  { value: "album", label: "Album" },
  { value: "date_added", label: "Date Added" },
  { value: "last_played_at", label: "Last Played" },
  { value: "play_count", label: "Play Count" },
  { value: "rating", label: "Rating" },
  { value: "duration", label: "Duration" },
];

// ── Default rule ────────────────────────────────────────────────

function defaultCondition(): RuleEntry {
  return { field: "genre", op: "is", value: "" };
}

function defaultGroup(): RuleEntry {
  return { match: "any", rules: [defaultCondition()] };
}

// ── Check if RuleEntry is a group ───────────────────────────────

function isGroup(entry: RuleEntry): entry is { match: "all" | "any"; rules: RuleEntry[] } {
  return "match" in entry;
}

// ── Rule Row ────────────────────────────────────────────────────

function RuleRow({
  rule,
  onChange,
  onRemove,
}: {
  rule: RuleEntry;
  onChange: (r: RuleEntry) => void;
  onRemove: () => void;
}) {
  if (isGroup(rule)) return null;
  const cond = rule as { field: string; op: string; value?: unknown };
  const fieldType = getFieldType(cond.field);
  const ops = OPS_BY_TYPE[fieldType];

  // Ensure current op is valid for field type
  const validOp = ops.find((o) => o.value === cond.op) ? cond.op : ops[0].value;
  if (validOp !== cond.op) {
    // Auto-correct on next tick
    setTimeout(() => onChange({ ...cond, op: validOp, value: undefined }), 0);
  }

  const needsValue = !["is_true", "is_false", "is_set", "is_not_set"].includes(cond.op);

  return (
    <div className="flex items-center gap-2 py-1">
      {/* Field select */}
      <select
        value={cond.field}
        onChange={(e) =>
          onChange({ field: e.target.value, op: OPS_BY_TYPE[getFieldType(e.target.value)][0].value, value: undefined })
        }
        className="bg-n-800 text-n-200 text-xs rounded px-2 py-1 border border-n-700 min-w-[120px]"
      >
        {FIELD_GROUPS.map((g) => (
          <optgroup key={g.label} label={g.label}>
            {g.fields.map((f) => (
              <option key={f} value={f}>
                {FIELD_LABELS[f]}
              </option>
            ))}
          </optgroup>
        ))}
      </select>

      {/* Operator select */}
      <select
        value={cond.op}
        onChange={(e) => onChange({ ...cond, op: e.target.value, value: undefined })}
        className="bg-n-800 text-n-200 text-xs rounded px-2 py-1 border border-n-700 min-w-[110px]"
      >
        {ops.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      {/* Value input */}
      {needsValue && cond.op === "between" ? (
        <div className="flex items-center gap-1">
          <input
            type="number"
            value={Array.isArray(cond.value) ? (cond.value as number[])[0] ?? "" : ""}
            onChange={(e) => {
              const arr = Array.isArray(cond.value) ? [...(cond.value as number[])] : [0, 0];
              arr[0] = Number(e.target.value);
              onChange({ ...cond, value: arr });
            }}
            className="bg-n-800 text-n-200 text-xs rounded px-2 py-1 border border-n-700 w-16"
          />
          <span className="text-n-500 text-xs">and</span>
          <input
            type="number"
            value={Array.isArray(cond.value) ? (cond.value as number[])[1] ?? "" : ""}
            onChange={(e) => {
              const arr = Array.isArray(cond.value) ? [...(cond.value as number[])] : [0, 0];
              arr[1] = Number(e.target.value);
              onChange({ ...cond, value: arr });
            }}
            className="bg-n-800 text-n-200 text-xs rounded px-2 py-1 border border-n-700 w-16"
          />
        </div>
      ) : needsValue && (cond.op === "in_last" || cond.op === "not_in_last") ? (
        <div className="flex items-center gap-1">
          <input
            type="number"
            value={(cond.value as number) ?? 30}
            onChange={(e) => onChange({ ...cond, value: Number(e.target.value) })}
            className="bg-n-800 text-n-200 text-xs rounded px-2 py-1 border border-n-700 w-16"
          />
          <span className="text-n-500 text-xs">days</span>
        </div>
      ) : needsValue && (cond.op === "before" || cond.op === "after") ? (
        <input
          type="date"
          value={(cond.value as string) ?? ""}
          onChange={(e) => onChange({ ...cond, value: e.target.value })}
          className="bg-n-800 text-n-200 text-xs rounded px-2 py-1 border border-n-700"
        />
      ) : needsValue && fieldType === "numeric" ? (
        <div className="flex items-center gap-1">
          <input
            type="number"
            value={(cond.value as number) ?? ""}
            onChange={(e) => onChange({ ...cond, value: Number(e.target.value) })}
            className="bg-n-800 text-n-200 text-xs rounded px-2 py-1 border border-n-700 w-20"
          />
          {cond.field === "rating" && <span className="text-n-500 text-xs">stars</span>}
        </div>
      ) : needsValue ? (
        <input
          type="text"
          value={(cond.value as string) ?? ""}
          onChange={(e) => onChange({ ...cond, value: e.target.value })}
          placeholder="value"
          className="bg-n-800 text-n-200 text-xs rounded px-2 py-1 border border-n-700 flex-1 min-w-[100px]"
        />
      ) : null}

      {/* Remove button */}
      <button
        onClick={onRemove}
        className="text-n-500 hover:text-n-300 transition-colors ml-auto shrink-0"
        title="Remove rule"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}

// ── Rule Group ──────────────────────────────────────────────────

function RuleGroupEditor({
  group,
  onChange,
  onRemove,
  depth,
}: {
  group: { match: "all" | "any"; rules: RuleEntry[] };
  onChange: (g: RuleEntry) => void;
  onRemove?: () => void;
  depth: number;
}) {
  const updateRule = (index: number, updated: RuleEntry) => {
    const next = [...group.rules];
    next[index] = updated;
    onChange({ ...group, rules: next });
  };

  const removeRule = (index: number) => {
    const next = group.rules.filter((_, i) => i !== index);
    onChange({ ...group, rules: next });
  };

  const addCondition = () => {
    onChange({ ...group, rules: [...group.rules, defaultCondition()] });
  };

  const addGroup = () => {
    onChange({ ...group, rules: [...group.rules, defaultGroup()] });
  };

  return (
    <div
      className={`rounded-md border border-n-700 bg-n-900/50 p-2 ${depth > 0 ? "ml-4 mt-1" : ""}`}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs text-n-400">Match</span>
        <select
          value={group.match}
          onChange={(e) => onChange({ ...group, match: e.target.value as "all" | "any" })}
          className="bg-n-800 text-n-200 text-xs rounded px-2 py-1 border border-n-700"
        >
          <option value="all">ALL</option>
          <option value="any">ANY</option>
        </select>
        <span className="text-xs text-n-400">of the following:</span>
        {onRemove && (
          <button
            onClick={onRemove}
            className="text-n-500 hover:text-n-300 transition-colors ml-auto"
            title="Remove group"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>

      {group.rules.map((rule, i) =>
        isGroup(rule) ? (
          <RuleGroupEditor
            key={i}
            group={rule}
            onChange={(g) => updateRule(i, g)}
            onRemove={() => removeRule(i)}
            depth={depth + 1}
          />
        ) : (
          <RuleRow
            key={i}
            rule={rule}
            onChange={(r) => updateRule(i, r)}
            onRemove={() => removeRule(i)}
          />
        ),
      )}

      <div className="flex gap-2 mt-1">
        <button
          onClick={addCondition}
          className="text-xs text-accent hover:text-accent transition-colors"
        >
          + Add Rule
        </button>
        {depth < 2 && (
          <button
            onClick={addGroup}
            className="text-xs text-accent hover:text-accent transition-colors"
          >
            + Add Group
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main Editor ─────────────────────────────────────────────────

interface SmartPlaylistEditorProps {
  onSave: (id: number) => void;
  onClose: () => void;
  editingPlaylist?: Playlist;
}

export function SmartPlaylistEditor({
  onSave,
  onClose,
  editingPlaylist,
}: SmartPlaylistEditorProps) {
  const isEditing = !!editingPlaylist;

  // Parse existing rules or defaults
  const initial = useMemo<SmartPlaylistRules>(() => {
    if (editingPlaylist?.rulesJson) {
      try {
        return JSON.parse(editingPlaylist.rulesJson);
      } catch {
        /* fall through */
      }
    }
    return { match: "all" as const, rules: [defaultCondition()], limit: undefined };
  }, [editingPlaylist]);

  const [name, setName] = useState(editingPlaylist?.name ?? "");
  const [matchMode, setMatchMode] = useState<"all" | "any">(initial.match);
  const [rules, setRules] = useState<RuleEntry[]>(initial.rules);
  const [limitEnabled, setLimitEnabled] = useState(!!initial.limit);
  const [limitCount, setLimitCount] = useState(initial.limit?.count ?? 25);
  const [limitSortBy, setLimitSortBy] = useState(initial.limit?.sortBy ?? "rating");
  const [limitSortDir, setLimitSortDir] = useState<"asc" | "desc">(
    initial.limit?.sortDir ?? "desc",
  );
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const previewTimer = useRef<ReturnType<typeof setTimeout>>(null);

  // Build the current rules object
  const currentRules = useCallback((): SmartPlaylistRules => {
    return {
      match: matchMode,
      rules,
      limit: limitEnabled
        ? { count: limitCount, sortBy: limitSortBy, sortDir: limitSortDir }
        : undefined,
    };
  }, [matchMode, rules, limitEnabled, limitCount, limitSortBy, limitSortDir]);

  // Debounced preview
  useEffect(() => {
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(async () => {
      try {
        // Create a temporary evaluation by saving & immediately querying
        // Actually we can't query without saving — so we'll create a temp smart playlist,
        // count its tracks, then delete it. That's expensive.
        // Better approach: just build the rules and POST to a hypothetical preview endpoint.
        // Since we don't have a preview command, we'll skip real preview for now
        // and show "Save to see results"
        setPreviewCount(null);
      } catch {
        setPreviewCount(null);
      }
    }, 500);
    return () => {
      if (previewTimer.current) clearTimeout(previewTimer.current);
    };
  }, [matchMode, rules, limitEnabled, limitCount, limitSortBy, limitSortDir]);

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const rulesJson = JSON.stringify(currentRules());
      if (isEditing) {
        await updateSmartPlaylist(editingPlaylist!.id, name, rulesJson);
        onSave(editingPlaylist!.id);
      } else {
        const id = await createSmartPlaylist(name, rulesJson);
        onSave(id);
      }
    } catch (err) {
      console.error("Failed to save smart playlist:", err);
    } finally {
      setSaving(false);
    }
  };

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const rootGroup: { match: "all" | "any"; rules: RuleEntry[] } = {
    match: matchMode,
    rules,
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-n-900 border border-n-700 rounded-lg shadow-xl w-[560px] max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="px-4 pt-4 pb-2 border-b border-n-800">
          <h2 className="text-sm font-semibold text-n-200">
            {isEditing ? "Edit Smart Playlist" : "New Smart Playlist"}
          </h2>
        </div>

        {/* Body */}
        <div className="px-4 py-3 flex-1 overflow-y-auto min-h-0 space-y-3">
          {/* Name */}
          <div>
            <label className="text-xs text-n-400 block mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              placeholder="Smart Playlist Name"
              className="w-full bg-n-800 text-n-200 text-sm rounded px-3 py-1.5 border border-n-700 outline-none focus:border-accent"
            />
          </div>

          {/* Rules */}
          <RuleGroupEditor
            group={rootGroup}
            onChange={(g) => {
              if (isGroup(g)) {
                setMatchMode(g.match);
                setRules(g.rules);
              }
            }}
            depth={0}
          />

          {/* Limit */}
          <div className="flex items-center gap-2 flex-wrap">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={limitEnabled}
                onChange={(e) => setLimitEnabled(e.target.checked)}
                className="accent-accent"
              />
              <span className="text-xs text-n-300">Limit to</span>
            </label>
            {limitEnabled && (
              <>
                <input
                  type="number"
                  value={limitCount}
                  onChange={(e) => setLimitCount(Math.max(1, Number(e.target.value)))}
                  className="bg-n-800 text-n-200 text-xs rounded px-2 py-1 border border-n-700 w-16"
                />
                <span className="text-xs text-n-400">items sorted by</span>
                <select
                  value={limitSortBy}
                  onChange={(e) => setLimitSortBy(e.target.value)}
                  className="bg-n-800 text-n-200 text-xs rounded px-2 py-1 border border-n-700"
                >
                  {SORT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <select
                  value={limitSortDir}
                  onChange={(e) => setLimitSortDir(e.target.value as "asc" | "desc")}
                  className="bg-n-800 text-n-200 text-xs rounded px-2 py-1 border border-n-700"
                >
                  <option value="desc">Desc</option>
                  <option value="asc">Asc</option>
                </select>
              </>
            )}
          </div>

          {previewCount !== null && (
            <p className="text-xs text-n-500">
              Preview: {previewCount} songs match
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-n-800 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-n-400 hover:text-n-200 transition-colors rounded"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!name.trim() || saving}
            className="px-4 py-1.5 text-xs bg-accent hover:bg-accent/80 disabled:opacity-50 text-white rounded transition-colors"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
