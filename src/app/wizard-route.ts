export const WIZARD_STEPS = ["source", "words", "style", "result"] as const;

export type WizardStep = (typeof WIZARD_STEPS)[number];

export const SHARE_VIEW_PATH = "/view";
export const SHARE_PNG_PATH = "/png";
export const SHARE_SVG_PATH = "/svg";

export type SharedImageFormat = "png" | "svg";

export function sharedImageFormatForPath(
  pathname: string,
): SharedImageFormat | undefined {
  let end = pathname.length;
  while (end > 0 && pathname[end - 1] === "/") end -= 1;
  const normalizedPath = pathname.slice(0, end);
  if (normalizedPath === SHARE_PNG_PATH) return "png";
  if (normalizedPath === SHARE_SVG_PATH) return "svg";
  return undefined;
}

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
