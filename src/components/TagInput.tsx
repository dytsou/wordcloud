import { useState } from "react";
import type { KeyboardEvent } from "react";

interface TagInputProps {
  id: string;
  value: readonly string[];
  disabled?: boolean;
  placeholder?: string;
  onChange: (value: string[]) => void;
}

export function TagInput({
  id,
  value,
  disabled = false,
  placeholder,
  onChange,
}: TagInputProps) {
  const [draft, setDraft] = useState("");

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;

    if (event.key === "Enter") {
      event.preventDefault();
      const nextTag = draft.trim();
      if (!nextTag) return;
      if (!value.includes(nextTag)) onChange([...value, nextTag]);
      setDraft("");
      return;
    }

    if (event.key === "Backspace" && !draft && value.length > 0) {
      event.preventDefault();
      onChange(value.slice(0, -1));
    }
  };

  return (
    <div className="tag-input" aria-disabled={disabled}>
      <div className="tag-list" role="list" aria-label="已加入的標籤">
        {value.map((tag, index) => (
          <span className="tag-chip" key={`${tag}-${index}`} role="listitem">
            <span className="tag-chip-value">{tag}</span>
            <button
              className="tag-remove"
              type="button"
              disabled={disabled}
              aria-label={`移除標籤 ${tag}`}
              onClick={() =>
                onChange(value.filter((_, tagIndex) => tagIndex !== index))
              }
            >
              ×
            </button>
          </span>
        ))}
        <input
          id={id}
          className="tag-entry"
          type="text"
          value={draft}
          disabled={disabled}
          placeholder={placeholder}
          autoComplete="off"
          aria-keyshortcuts="Enter"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
        />
      </div>
    </div>
  );
}
