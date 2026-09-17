import { useState } from "react";
import { LIMITS } from "../core/limits";
import type { TokenRule, TokenizerSettings } from "../core/types";
import { TagInput } from "./TagInput";

interface TokenRulesPanelProps {
  settings: TokenizerSettings;
  disabled?: boolean;
  onSettingsChange: (settings: TokenizerSettings) => void;
}

const RULE_GROUPS = [
  {
    kind: "protected",
    label: "固定文字",
    description:
      "讓這段文字在分析時保持原樣；若與其他設定重疊，優先以這段為準。",
    addLabel: "新增固定文字",
  },
  {
    kind: "split",
    label: "拆分文字",
    description: "把一段文字拆成你指定的詞，適合修正分詞結果。",
    addLabel: "新增拆分文字",
  },
  {
    kind: "merge",
    label: "合併文字",
    description: "把連續出現的詞合成一個詞，適合建立固定用語。",
    addLabel: "新增合併文字",
  },
] as const satisfies ReadonlyArray<{
  kind: TokenRule["kind"];
  label: string;
  description: string;
  addLabel: string;
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
  const [isPrecisionOpen, setIsPrecisionOpen] = useState(false);
  const rules = settings.rules;

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
          <p className="section-kicker">VOCABULARY</p>
          <h2 id="rules-heading">Give phrases a role.</h2>
        </div>
        <span className="count-badge">
          {rules.length}/{LIMITS.maxCustomRules}
        </span>
      </div>
      <div className="field">
        <label className="field-label" htmlFor="dictionary">
          自訂詞典 <span>(按 Enter 新增，多字詞會保留)</span>
        </label>
        <TagInput
          id="dictionary"
          value={settings.dictionary}
          disabled={disabled}
          onChange={(dictionary) =>
            onSettingsChange({ ...settings, dictionary })
          }
          placeholder="例如：人工智慧 或 Cloudflare Workers"
        />
      </div>

      <button
        className="precision-disclosure"
        type="button"
        aria-expanded={isPrecisionOpen}
        aria-controls="precision-rules"
        onClick={() => setIsPrecisionOpen((open) => !open)}
      >
        <span>
          <strong>需要精準校正？</strong>
          <small>遇到切分、合併或固定用語問題時再打開。</small>
        </span>
        <span className="precision-disclosure-mark" aria-hidden="true">
          {isPrecisionOpen ? "−" : "+"}
        </span>
      </button>

      <div
        id="precision-rules"
        className="precision-rules"
        hidden={!isPrecisionOpen}
      >
        {RULE_GROUPS.map((group) => {
          const groupRules = rules.filter((rule) => rule.kind === group.kind);

          return (
            <section
              className="precision-group"
              data-rule-kind={group.kind}
              key={group.kind}
              aria-labelledby={`precision-${group.kind}-heading`}
            >
              <div className="precision-group-heading">
                <div>
                  <h3 id={`precision-${group.kind}-heading`}>{group.label}</h3>
                  <p>{group.description}</p>
                </div>
                <button
                  className="button button-quiet precision-add"
                  type="button"
                  disabled={disabled || rules.length >= LIMITS.maxCustomRules}
                  onClick={() => appendRule(group.kind)}
                >
                  {group.addLabel}
                </button>
              </div>

              <div className="precision-group-list">
                {groupRules.map((rule, groupIndex) => {
                  const ordinal = groupIndex + 1;
                  const removeLabel = `移除${group.label} ${ordinal}`;

                  return (
                    <div className="precision-rule" key={rule.id}>
                      <div className="precision-rule-fields">
                        {rule.kind === "protected" && (
                          <>
                            <label
                              className="rule-field-label"
                              htmlFor={ruleDomId(rule, "phrase")}
                            >
                              固定文字內容 {ordinal}
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
                              placeholder="例如：人工智慧"
                            />
                          </>
                        )}
                        {rule.kind === "split" && (
                          <>
                            <label
                              className="rule-field-label"
                              htmlFor={ruleDomId(rule, "source")}
                            >
                              要拆分的文字 {ordinal}
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
                              placeholder="例如：cloudnative"
                            />
                            <label
                              className="rule-field-label"
                              htmlFor={ruleDomId(rule, "terms")}
                            >
                              拆分後詞語 {ordinal}
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
                              placeholder="例如：雲, 端"
                            />
                          </>
                        )}
                        {rule.kind === "merge" && (
                          <>
                            <label
                              className="rule-field-label"
                              htmlFor={ruleDomId(rule, "source")}
                            >
                              要合併的文字 {ordinal}
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
                              placeholder="例如：data cloud"
                            />
                            <label
                              className="rule-field-label"
                              htmlFor={ruleDomId(rule, "term")}
                            >
                              合併後文字 {ordinal}
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
                              placeholder="例如：data-cloud"
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
                        移除
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
      ) && (
        <p className="warning-note">
          尚未完成的規則會在產生時被提示，不會靜默套用。
        </p>
      )}
    </section>
  );
}
