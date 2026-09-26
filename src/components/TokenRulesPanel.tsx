import { useState } from "react";
import { LIMITS } from "../core/limits";
import type { TokenRule, TokenizerSettings } from "../core/types";
import { useI18n } from "../i18n";
import { TagInput } from "./TagInput";

interface TokenRulesPanelProps {
  settings: TokenizerSettings;
  disabled?: boolean;
  onSettingsChange: (settings: TokenizerSettings) => void;
}

const RULE_GROUPS = [
  { kind: "protected" },
  { kind: "split" },
  { kind: "merge" },
] as const satisfies ReadonlyArray<{
  kind: TokenRule["kind"];
}>;

function newRule(kind: TokenRule["kind"], id: string): TokenRule {
  if (kind === "protected") return { id, kind, phrase: "", priority: 0 };
  if (kind === "split")
    return { id, kind, source: "", terms: [""], priority: 0 };
  return { id, kind, source: "", term: "", priority: 0 };
}

function nextRuleId(rules: TokenRule[]): string {
  let index = rules.length + 1;
  let id = `rule-${index}`;
  const existingIds = new Set(rules.map((rule) => rule.id));

  while (existingIds.has(id)) {
    index += 1;
    id = `rule-${index}`;
  }

  return id;
}

function ruleDomId(rule: TokenRule, field: string): string {
  const safeId = rule.id.replace(/[^a-zA-Z0-9_-]/gu, "-");
  return `precision-${safeId}-${field}`;
}

export function TokenRulesPanel({
  settings,
  disabled = false,
  onSettingsChange,
}: TokenRulesPanelProps) {
  const { t } = useI18n();
  const [isPrecisionOpen, setIsPrecisionOpen] = useState(false);
  const rules = settings.rules;
  const groupCopy = {
    protected: {
      label: t("fixedLabel"),
      description: t("fixedDescription"),
      addLabel: t("addFixed"),
    },
    split: {
      label: t("splitLabel"),
      description: t("splitDescription"),
      addLabel: t("addSplit"),
    },
    merge: {
      label: t("mergeLabel"),
      description: t("mergeDescription"),
      addLabel: t("addMerge"),
    },
  } as const;

  const updateRule = (ruleId: string, patch: Partial<TokenRule>) => {
    onSettingsChange({
      ...settings,
      rules: rules.map((rule) =>
        rule.id === ruleId ? { ...rule, ...patch } : rule,
      ) as TokenRule[],
    });
  };

  const appendRule = (kind: TokenRule["kind"]) => {
    if (disabled || rules.length >= LIMITS.maxCustomRules) return;
    onSettingsChange({
      ...settings,
      rules: [...rules, newRule(kind, nextRuleId(rules))],
    });
  };

  const removeRule = (ruleId: string) => {
    onSettingsChange({
      ...settings,
      rules: rules.filter((rule) => rule.id !== ruleId),
    });
  };

  return (
    <section className="panel rules-panel" aria-labelledby="rules-heading">
      <div className="panel-heading">
        <div>
          <p className="section-kicker">{t("vocabularyKicker")}</p>
          <h2 id="rules-heading">{t("vocabularyHeading")}</h2>
        </div>
        <span className="count-badge">
          {rules.length}/{LIMITS.maxCustomRules}
        </span>
      </div>
      <div className="field">
        <label className="field-label" htmlFor="dictionary">
          {t("customDictionaryLabel")} <span>{t("dictionarySuffix")}</span>
        </label>
        <TagInput
          id="dictionary"
          value={settings.dictionary}
          disabled={disabled}
          onChange={(dictionary) =>
            onSettingsChange({ ...settings, dictionary })
          }
          placeholder={t("dictionaryPlaceholder")}
        />
      </div>

      <div className="precision-disclosure-row">
        <button
          className="precision-disclosure"
          type="button"
          aria-expanded={isPrecisionOpen}
          aria-controls="precision-rules"
          aria-describedby="precision-open-hint"
          onClick={() => setIsPrecisionOpen((open) => !open)}
        >
          <span className="precision-disclosure-copy">
            <strong>{t("precisionOpen")}</strong>
            <span
              className="precision-disclosure-info"
              data-tooltip={t("precisionOpenHint")}
              aria-hidden="true"
            >
              i
            </span>
          </span>
          <span className="precision-disclosure-mark" aria-hidden="true">
            {isPrecisionOpen ? "−" : "+"}
          </span>
        </button>
        <span className="sr-only" id="precision-open-hint">
          {t("precisionOpenHint")}
        </span>
      </div>

      <div
        id="precision-rules"
        className="precision-rules"
        hidden={!isPrecisionOpen}
      >
        {RULE_GROUPS.map((group) => {
          const groupRules = rules.filter((rule) => rule.kind === group.kind);
          const copy = groupCopy[group.kind];

          return (
            <section
              className="precision-group"
              data-rule-kind={group.kind}
              key={group.kind}
              aria-labelledby={`precision-${group.kind}-heading`}
            >
              <div className="precision-group-heading">
                <div>
                  <h3 id={`precision-${group.kind}-heading`}>{copy.label}</h3>
                  <p>{copy.description}</p>
                </div>
                <button
                  className="button button-quiet precision-add"
                  type="button"
                  disabled={disabled || rules.length >= LIMITS.maxCustomRules}
                  onClick={() => appendRule(group.kind)}
                >
                  {copy.addLabel}
                </button>
              </div>

              <div className="precision-group-list">
                {groupRules.map((rule, groupIndex) => {
                  const ordinal = groupIndex + 1;
                  const removeLabel = t("removeRule", {
                    label: copy.label,
                    ordinal,
                  });

                  return (
                    <div className="precision-rule" key={rule.id}>
                      <div className="precision-rule-fields">
                        {rule.kind === "protected" && (
                          <>
                            <label
                              className="rule-field-label"
                              htmlFor={ruleDomId(rule, "phrase")}
                            >
                              {t("fixedField", { ordinal })}
                            </label>
                            <input
                              id={ruleDomId(rule, "phrase")}
                              value={rule.phrase}
                              disabled={disabled}
                              onChange={(event) =>
                                updateRule(rule.id, {
                                  phrase: event.target.value,
                                })
                              }
                              placeholder={t("dictionaryPlaceholder")}
                            />
                          </>
                        )}
                        {rule.kind === "split" && (
                          <>
                            <label
                              className="rule-field-label"
                              htmlFor={ruleDomId(rule, "source")}
                            >
                              {t("splitSourceField", { ordinal })}
                            </label>
                            <input
                              id={ruleDomId(rule, "source")}
                              value={rule.source}
                              disabled={disabled}
                              onChange={(event) =>
                                updateRule(rule.id, {
                                  source: event.target.value,
                                })
                              }
                              placeholder="e.g. cloudnative"
                            />
                            <label
                              className="rule-field-label"
                              htmlFor={ruleDomId(rule, "terms")}
                            >
                              {t("splitTermsField", { ordinal })}
                            </label>
                            <input
                              id={ruleDomId(rule, "terms")}
                              value={rule.terms.join(", ")}
                              disabled={disabled}
                              onChange={(event) =>
                                updateRule(rule.id, {
                                  terms: event.target.value
                                    .split(/[\s,，]+/u)
                                    .filter(Boolean),
                                })
                              }
                              placeholder="e.g. cloud, native"
                            />
                          </>
                        )}
                        {rule.kind === "merge" && (
                          <>
                            <label
                              className="rule-field-label"
                              htmlFor={ruleDomId(rule, "source")}
                            >
                              {t("mergeSourceField", { ordinal })}
                            </label>
                            <input
                              id={ruleDomId(rule, "source")}
                              value={rule.source}
                              disabled={disabled}
                              onChange={(event) =>
                                updateRule(rule.id, {
                                  source: event.target.value,
                                })
                              }
                              placeholder="e.g. data cloud"
                            />
                            <label
                              className="rule-field-label"
                              htmlFor={ruleDomId(rule, "term")}
                            >
                              {t("mergeTermField", { ordinal })}
                            </label>
                            <input
                              id={ruleDomId(rule, "term")}
                              value={rule.term}
                              disabled={disabled}
                              onChange={(event) =>
                                updateRule(rule.id, {
                                  term: event.target.value,
                                })
                              }
                              placeholder="e.g. data-cloud"
                            />
                          </>
                        )}
                      </div>
                      <button
                        className="precision-remove"
                        type="button"
                        aria-label={removeLabel}
                        disabled={disabled}
                        onClick={() => removeRule(rule.id)}
                      >
                        {t("remove")}
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      {rules.some((rule) =>
        rule.kind === "protected"
          ? !rule.phrase
          : rule.kind === "split"
            ? !rule.source || rule.terms.length === 0
            : !rule.source || !rule.term,
      ) && <p className="warning-note">{t("unfinishedRules")}</p>}
    </section>
  );
}
