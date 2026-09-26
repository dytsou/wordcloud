export const WIZARD_STEPS = ["source", "words", "style", "result"] as const;

export type WizardStep = (typeof WIZARD_STEPS)[number];

export const SHARE_VIEW_PATH = "/view";

export const WIZARD_STEP_PATHS: Record<WizardStep, string> = {
  source: "/create/source",
  words: "/create/words",
  style: "/create/style",
  result: "/create/result",
};

export function stepForPath(pathname: string): WizardStep {
  return (
    (Object.entries(WIZARD_STEP_PATHS).find(
      ([, path]) => path === pathname,
    )?.[0] as WizardStep | undefined) ?? "source"
  );
}

export function pathForStep(step: WizardStep): string {
  return WIZARD_STEP_PATHS[step];
}
