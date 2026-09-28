import { useState } from "react";
import type { KeyboardEvent } from "react";
import { useI18n } from "../i18n";

interface TagInputProps {
  readonly id: string;
  readonly value: readonly string[];
  readonly disabled?: boolean;
  readonly placeholder?: string;
  readonly onChange: (value: string[]) => void;
}

export function TagInput({
  id,
  value,
  disabled = false,
  placeholder,
  onChange,
}: TagInputProps) {
  const [draft, setDraft] = useState("");
  const { t } = useI18n();

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
      <ul className="tag-list" aria-label={t("tagList")}>
        {value.map((tag, index) => (
          <li className="tag-chip" key={`${tag}-${index}`}>
            <span className="tag-chip-value">{tag}</span>
            <button
              className="tag-remove"
              type="button"
              disabled={disabled}
              aria-label={t("removeTag", { tag })}
              onClick={() =>
                onChange(value.filter((_, tagIndex) => tagIndex !== index))
              }
            >
              ×
            </button>
          </li>
        ))}
        <li className="tag-entry-item">
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
        </li>
      </ul>
    </div>
  );
}
