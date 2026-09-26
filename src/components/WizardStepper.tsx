import { useI18n } from "../i18n";
import { WIZARD_STEPS, type WizardStep } from "../app/wizard-route";

interface WizardStepperProps {
  currentStep: WizardStep;
  remix?: boolean;
  onNavigate: (step: WizardStep) => void;
}

const STEP_LABEL_KEYS = {
  source: "wizardStepSource",
  words: "wizardStepWords",
  style: "wizardStepStyle",
  result: "wizardStepResult",
} as const;

export function WizardStepper({
  currentStep,
  remix = false,
  onNavigate,
}: WizardStepperProps) {
  const { t } = useI18n();
  const currentIndex = WIZARD_STEPS.indexOf(currentStep);

  return (
    <nav className="wizard-stepper" aria-label={t("wizardNavigation")}>
      <ol>
        {WIZARD_STEPS.map((step, index) => {
          const isCurrent = step === currentStep;
          const isEarlier = index < currentIndex;
          const isRemixLocked = remix && index < 2;
          const className = [
            "wizard-step",
            isCurrent ? "is-current" : "",
            isEarlier ? "is-complete" : "",
            isRemixLocked ? "is-unavailable" : "",
          ]
            .filter(Boolean)
            .join(" ");
          const content = (
            <>
              <span className="wizard-step-number" aria-hidden="true">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className="wizard-step-label">
                {t(STEP_LABEL_KEYS[step])}
              </span>
              {isEarlier && !isRemixLocked && (
                <span className="wizard-step-check" aria-hidden="true">
                  ✓
                </span>
              )}
            </>
          );

          return (
            <li className={className} key={step}>
              {isCurrent ? (
                <span aria-current="step">{content}</span>
              ) : isEarlier && !isRemixLocked ? (
                <button type="button" onClick={() => onNavigate(step)}>
                  {content}
                </button>
              ) : (
                <span aria-disabled="true">{content}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
