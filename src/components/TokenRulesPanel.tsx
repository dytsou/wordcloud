import { useState } from "react";
import { LIMITS } from "../core/limits";
import type { TokenRule, TokenizerSettings } from "../core/types";
import { TagInput } from "./TagInput";

interface TokenRulesPanelProps {
  settings: TokenizerSettings;
  disabled?: boolean;
  onSettingsChange: (settings: TokenizerSettings) => void;
}

function newRule(kind: TokenRule["kind"], index: number): TokenRule {
  if (kind === "protected")
    return { id: `rule-${index}`, kind, phrase: "", priority: 0 };
  if (kind === "split")
    return { id: `rule-${index}`, kind, source: "", terms: [""], priority: 0 };
  return { id: `rule-${index}`, kind, source: "", term: "", priority: 0 };
}

export function TokenRulesPanel({
  settings,
  disabled = false,
  onSettingsChange,
}: TokenRulesPanelProps) {
  const [kind, setKind] = useState<TokenRule["kind"]>("protected");
  const rules = settings.rules;
  const updateRule = (index: number, patch: Partial<TokenRule>) => {
    onSettingsChange({
      ...settings,
      rules: rules.map((rule, ruleIndex) =>
        ruleIndex === index ? { ...rule, ...patch } : rule,
      ) as TokenRule[],
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
      <div className="rule-list">
        {rules.map((rule, index) => (
          <div className="rule-row" key={rule.id}>
            <span className="rule-index">
              {String(index + 1).padStart(2, "0")}
            </span>
            <div className="rule-fields">
              <label className="sr-only" htmlFor={`rule-kind-${index}`}>
                規則類型
              </label>
              <select
                id={`rule-kind-${index}`}
                value={rule.kind}
                disabled={disabled}
                onChange={(event) =>
                  updateRule(
                    index,
                    newRule(event.target.value as TokenRule["kind"], index + 1),
                  )
                }
              >
                <option value="protected">保護片語</option>
                <option value="split">拆分 literal</option>
                <option value="merge">合併 literal</option>
              </select>
              {rule.kind === "protected" && (
                <input
                  aria-label={`規則 ${index + 1} 片語`}
                  value={rule.phrase}
                  disabled={disabled}
                  onChange={(event) =>
                    updateRule(index, { phrase: event.target.value })
                  }
                  placeholder="片語，例如：人工智慧"
                />
              )}
              {rule.kind === "split" && (
                <>
                  <input
                    aria-label={`規則 ${index + 1} 來源`}
                    value={rule.source}
                    disabled={disabled}
                    onChange={(event) =>
                      updateRule(index, { source: event.target.value })
                    }
                    placeholder="來源 literal"
                  />
                  <input
                    aria-label={`規則 ${index + 1} 輸出詞`}
                    value={rule.terms.join(", ")}
                    disabled={disabled}
                    onChange={(event) =>
                      updateRule(index, {
                        terms: event.target.value
                          .split(/[\s,，]+/u)
                          .filter(Boolean),
                      })
                    }
                    placeholder="輸出詞：雲, 端"
                  />
                </>
              )}
              {rule.kind === "merge" && (
                <>
                  <input
                    aria-label={`規則 ${index + 1} 來源`}
                    value={rule.source}
                    disabled={disabled}
                    onChange={(event) =>
                      updateRule(index, { source: event.target.value })
                    }
                    placeholder="來源序列，例如：data cloud"
                  />
                  <input
                    aria-label={`規則 ${index + 1} 合併詞`}
                    value={rule.term}
                    disabled={disabled}
                    onChange={(event) =>
                      updateRule(index, { term: event.target.value })
                    }
                    placeholder="合併成一詞"
                  />
                </>
              )}
            </div>
            <button
              className="icon-button"
              type="button"
              aria-label={`移除規則 ${index + 1}`}
              disabled={disabled}
              onClick={() =>
                onSettingsChange({
                  ...settings,
                  rules: rules.filter((_, ruleIndex) => ruleIndex !== index),
                })
              }
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <div className="rule-add-row">
        <label className="sr-only" htmlFor="new-rule-kind">
          新增規則類型
        </label>
        <select
          id="new-rule-kind"
          value={kind}
          disabled={disabled}
          onChange={(event) => setKind(event.target.value as TokenRule["kind"])}
        >
          <option value="protected">保護片語</option>
          <option value="split">拆分 literal</option>
          <option value="merge">合併 literal</option>
        </select>
        <button
          className="button button-quiet"
          type="button"
          disabled={disabled || rules.length >= LIMITS.maxCustomRules}
          onClick={() =>
            onSettingsChange({
              ...settings,
              rules: [...rules, newRule(kind, rules.length + 1)],
            })
          }
        >
          + 新增規則
        </button>
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
