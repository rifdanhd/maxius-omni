"use client";

import { useEffect, useState } from "react";
import { Check, LoaderCircle, RotateCcw } from "lucide-react";

type InlineStockInputProps = {
  value: number;
  label: string;
  onSave: (value: number) => Promise<unknown>;
  disabled?: boolean;
};

export function InlineStockInput({ value, label, onSave, disabled = false }: InlineStockInputProps) {
  const [draft, setDraft] = useState(String(value));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setDraft(String(value)));
    return () => window.cancelAnimationFrame(frame);
  }, [value]);

  const parsed = Number(draft);
  const valid = draft.trim() !== "" && Number.isInteger(parsed) && parsed >= 0;
  const dirty = valid && parsed !== value;

  async function save() {
    if (!dirty || saving || disabled) return;
    setSaving(true);
    try {
      await onSave(parsed);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="inline-flex min-w-[8.5rem] items-center justify-end gap-1">
      <input
        type="number"
        min={0}
        step={1}
        inputMode="numeric"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") void save();
          if (event.key === "Escape") setDraft(String(value));
        }}
        aria-label={label}
        aria-invalid={draft.trim() !== "" && !valid}
        disabled={saving || disabled}
        className="h-9 w-20 rounded-md border border-border bg-background px-2 text-right text-sm font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
      />
      {dirty ? (
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || disabled}
          aria-label={`Simpan ${label.toLowerCase()}`}
          className="inline-flex size-9 items-center justify-center rounded-md text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        >
          {saving ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" /> : <Check className="size-4" />}
        </button>
      ) : draft !== String(value) ? (
        <button
          type="button"
          onClick={() => setDraft(String(value))}
          aria-label={`Batalkan perubahan ${label.toLowerCase()}`}
          className="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <RotateCcw className="size-4" />
        </button>
      ) : (
        <span className="size-9" aria-hidden="true" />
      )}
    </div>
  );
}
