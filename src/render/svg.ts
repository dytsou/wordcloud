import type { SceneModel, SceneWord } from "../core/scene";
import {
  buildShapeFillDots,
  DOT_RADIUS,
  shapeFillDotColor,
} from "../core/shape-fill";
import { assertRenderableScene } from "./safe-scene";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

export interface SceneSvgOptions {
  title?: string;
  description?: string;
}

const DEFAULT_TITLE = "文字雲預覽";

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function numberAttribute(value: number): string {
  return String(Math.round(value * 100) / 100);
}

function safeOption(value: string | undefined, fallback: string): string {
  const chosen = value ?? fallback;
  // The control-character range is intentional for serialized SVG metadata.
  if (
    chosen.length === 0 ||
    // eslint-disable-next-line no-control-regex
    /[\u0000-\u001F\u007F]/u.test(chosen)
  ) {
    throw new Error("SVG title and description must be safe text.");
  }
  return chosen;
}

function metadataText(words: SceneWord[]): string {
  return words
    .map(
      (word) =>
        `rank ${word.rank}; count ${word.count}; status ${word.status}; term ${word.term}`,
    )
    .join("\n");
}

function appendSvgText(
  document: Document,
  parent: SVGElement,
  tag: "title" | "desc" | "metadata" | "text",
  value: string,
): SVGElement {
  const element = document.createElementNS(SVG_NAMESPACE, tag);
  element.textContent = value;
  parent.append(element);
  return element;
}

function appendSceneSvgChildren(
  document: Document,
  svg: SVGSVGElement,
  scene: SceneModel,
  title: string,
  description: string,
  placedWords: SceneWord[],
): void {
  const titleElement = appendSvgText(document, svg, "title", title);
  titleElement.setAttribute("id", "wordcloud-title");
  const descriptionElement = appendSvgText(document, svg, "desc", description);
  descriptionElement.setAttribute("id", "wordcloud-description");

  const background = document.createElementNS(SVG_NAMESPACE, "rect");
  background.setAttribute("x", "0");
  background.setAttribute("y", "0");
  background.setAttribute("width", numberAttribute(scene.canvas.width));
  background.setAttribute("height", numberAttribute(scene.canvas.height));
  background.setAttribute("fill", scene.background);
  background.setAttribute("aria-hidden", "true");
  svg.append(background);

  const fillDots = buildShapeFillDots(scene);
  if (fillDots.length > 0) {
    const fillGroup = document.createElementNS(SVG_NAMESPACE, "g");
    fillGroup.setAttribute("id", "wordcloud-fill");
    fillGroup.setAttribute("aria-hidden", "true");
    fillGroup.setAttribute("fill", shapeFillDotColor(scene));
    for (const dot of fillDots) {
      const circle = document.createElementNS(SVG_NAMESPACE, "circle");
      circle.setAttribute("cx", numberAttribute(dot.x));
      circle.setAttribute("cy", numberAttribute(dot.y));
      circle.setAttribute("r", numberAttribute(DOT_RADIUS));
      fillGroup.append(circle);
    }
    svg.append(fillGroup);
  }

  const wordsGroup = document.createElementNS(SVG_NAMESPACE, "g");
  wordsGroup.setAttribute("id", "wordcloud-words");
  for (const word of placedWords) {
    const element = document.createElementNS(SVG_NAMESPACE, "text");
    const centerX = word.x + word.width / 2;
    const centerY = word.y + word.height / 2;
    element.setAttribute("x", numberAttribute(centerX));
    element.setAttribute("y", numberAttribute(centerY));
    element.setAttribute("text-anchor", "middle");
    element.setAttribute("dominant-baseline", "central");
    element.setAttribute("fill", word.color);
    element.setAttribute("font-size", numberAttribute(word.fontSize));
    element.setAttribute("font-weight", "500");
    element.setAttribute("font-family", scene.fontFamily);
    element.setAttribute(
      "transform",
      `rotate(${numberAttribute(word.angle)} ${numberAttribute(centerX)} ${numberAttribute(centerY)})`,
    );
    element.dataset.rank = String(word.rank);
    element.dataset.count = String(word.count);
    element.textContent = word.term;
    wordsGroup.append(element);
  }
  svg.append(wordsGroup);

  const metadata = appendSvgText(
    document,
    svg,
    "metadata",
    metadataText(scene.words),
  );
  metadata.setAttribute("id", "wordcloud-records");
}

export function createSceneSvgElement(
  scene: SceneModel,
  options: SceneSvgOptions = {},
): SVGSVGElement {
  assertRenderableScene(scene);
  if (typeof document === "undefined") {
    throw new TypeError("SVG DOM export requires a browser document.");
  }
  const title = safeOption(options.title, DEFAULT_TITLE);
  const description = safeOption(
    options.description,
    `${scene.words.length} words; unplaced words remain in the records metadata.`,
  );
  const placedWords = scene.words.filter((word) => word.status === "placed");
  const svg = document.createElementNS(SVG_NAMESPACE, "svg");
  svg.setAttribute("xmlns", SVG_NAMESPACE);
  svg.setAttribute("width", numberAttribute(scene.canvas.width));
  svg.setAttribute("height", numberAttribute(scene.canvas.height));
  svg.setAttribute(
    "viewBox",
    `0 0 ${numberAttribute(scene.canvas.width)} ${numberAttribute(scene.canvas.height)}`,
  );
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-labelledby", "wordcloud-title wordcloud-description");
  appendSceneSvgChildren(document, svg, scene, title, description, placedWords);
  return svg;
}

function serializeSceneSvg(
  scene: SceneModel,
  options: SceneSvgOptions = {},
): string {
  assertRenderableScene(scene);
  const title = escapeXml(safeOption(options.title, DEFAULT_TITLE));
  const description = escapeXml(
    safeOption(
      options.description,
      `${scene.words.length} words; unplaced words remain in the records metadata.`,
    ),
  );
  const placedWords = scene.words.filter((word) => word.status === "placed");
  const fillDots = buildShapeFillDots(scene);
  const fill = fillDots.length
    ? `<g id="wordcloud-fill" aria-hidden="true" fill="${escapeXml(shapeFillDotColor(scene))}">${fillDots
        .map(
          (dot) =>
            `<circle cx="${numberAttribute(dot.x)}" cy="${numberAttribute(dot.y)}" r="${numberAttribute(DOT_RADIUS)}"/>`,
        )
        .join("")}</g>`
    : "";
  const words = placedWords
    .map((word) => {
      const centerX = word.x + word.width / 2;
      const centerY = word.y + word.height / 2;
      return `<text x="${numberAttribute(centerX)}" y="${numberAttribute(centerY)}" text-anchor="middle" dominant-baseline="central" fill="${escapeXml(word.color)}" font-size="${numberAttribute(word.fontSize)}" font-weight="500" font-family="${escapeXml(scene.fontFamily)}" transform="rotate(${numberAttribute(word.angle)} ${numberAttribute(centerX)} ${numberAttribute(centerY)})" data-rank="${word.rank}" data-count="${word.count}">${escapeXml(word.term)}</text>`;
    })
    .join("");
  return `<svg xmlns="${SVG_NAMESPACE}" width="${numberAttribute(scene.canvas.width)}" height="${numberAttribute(scene.canvas.height)}" viewBox="0 0 ${numberAttribute(scene.canvas.width)} ${numberAttribute(scene.canvas.height)}" role="img" aria-labelledby="wordcloud-title wordcloud-description"><title id="wordcloud-title">${title}</title><desc id="wordcloud-description">${description}</desc><rect x="0" y="0" width="${numberAttribute(scene.canvas.width)}" height="${numberAttribute(scene.canvas.height)}" fill="${escapeXml(scene.background)}" aria-hidden="true"/>${fill}<g id="wordcloud-words">${words}</g><metadata id="wordcloud-records">${escapeXml(metadataText(scene.words))}</metadata></svg>`;
}

export function renderSceneSvg(
  scene: SceneModel,
  options: SceneSvgOptions = {},
): string {
  if (typeof document !== "undefined" && typeof XMLSerializer !== "undefined") {
    return new XMLSerializer().serializeToString(
      createSceneSvgElement(scene, options),
    );
  }
  return serializeSceneSvg(scene, options);
}

export { escapeXml };
