import { describe, expect, it } from "vitest";
import { snapshotScene } from "../fixtures/snapshots";
import type { SceneModel } from "../../src/core/scene";
import {
  getAccessibleWords,
  renderAccessibleSummary,
} from "../../src/render/accessibility";
import {
  createPngRenderPlan,
  renderScenePng,
  type CanvasContextLike,
  type CanvasLike,
} from "../../src/render/png";
import { renderSceneSvg } from "../../src/render/svg";

function createFakeCanvas() {
  const operations: string[] = [];
  const context: CanvasContextLike = {
    fillStyle: "",
    font: "",
    textAlign: "left",
    textBaseline: "alphabetic",
    save: () => operations.push("save"),
    restore: () => operations.push("restore"),
    translate: (x, y) => operations.push(`translate:${x}:${y}`),
    rotate: (angle) => operations.push(`rotate:${angle}`),
    fillRect: (x, y, width, height) =>
      operations.push(`rect:${x}:${y}:${width}:${height}`),
    fillText: (text) => operations.push(`text:${text}`),
  };
  const canvas: CanvasLike = {
    width: 0,
    height: 0,
    getContext: () => context,
    toBlob: (callback) => callback(new Blob(["png"], { type: "image/png" })),
  };
  return { canvas, operations };
}

describe("scene renderers", () => {
  it("escapes terms and emits only an allowlisted SVG surface", () => {
    const scene: SceneModel = {
      ...snapshotScene,
      words: [
        {
          ...snapshotScene.words[0],
          term: `<script>alert("x")</script>&`,
        },
      ],
    };
    const svg = renderSceneSvg(scene);

    expect(svg).toContain(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;",
    );
    expect(svg).not.toContain("<script");
    expect(svg).not.toMatch(/foreignObject|<style|<iframe|url\(|on[a-z]+=/iu);
    expect(svg).toContain('data-rank="1"');
    expect(svg).toContain('data-count="2"');
  });

  it("keeps visual and accessible records aligned, including omitted words", () => {
    const scene: SceneModel = {
      ...snapshotScene,
      words: [
        snapshotScene.words[0],
        {
          ...snapshotScene.words[0],
          term: "omitted",
          rank: 2,
          count: 1,
          status: "unplaceable",
          reason: "no-fit",
          x: 0,
          y: 0,
          width: 200,
          height: 40,
        },
      ],
    };
    const plan = createPngRenderPlan(scene);
    const accessible = getAccessibleWords(scene);

    expect(plan.words.map((word) => word.term)).toEqual(
      accessible.map((word) => word.term),
    );
    expect(plan.placedWords.map((word) => word.term)).toEqual(["hello"]);
    expect(plan.omittedWords.map((word) => word.term)).toEqual(["omitted"]);
    expect(renderAccessibleSummary(scene)).toMatch(/1 placed and 1 omitted/);
  });

  it("draws PNG through a bounded canvas and returns a nonempty blob", async () => {
    const fake = createFakeCanvas();
    const blob = await renderScenePng(sceneWithRotation(), {
      createCanvas: () => fake.canvas,
    });

    expect(blob.type).toBe("image/png");
    expect(blob.size).toBeGreaterThan(0);
    expect(fake.canvas.width).toBe(320);
    expect(fake.canvas.height).toBe(220);
    expect(fake.operations).toContain("rect:0:0:320:220");
    expect(fake.operations).toContain("text:hello");
  });

  it("rejects external style values before export", () => {
    expect(() =>
      renderSceneSvg({
        ...snapshotScene,
        background: "url(https://evil.example)" as string,
      }),
    ).toThrow(/safe hex color/iu);
  });

  it("surfaces canvas and blob failures during PNG export", async () => {
    const missingContext = createFakeCanvas();
    missingContext.canvas.getContext = () => null;
    await expect(
      renderScenePng(sceneWithRotation(), {
        createCanvas: () => missingContext.canvas,
      }),
    ).rejects.toThrow("2D canvas is unavailable");

    for (const toBlob of [
      (callback: (blob: Blob | null) => void) => callback(null),
      (callback: (blob: Blob | null) => void) =>
        callback(new Blob([], { type: "image/png" })),
      () => {
        throw new Error("toBlob failed");
      },
    ]) {
      const failing = createFakeCanvas();
      failing.canvas.toBlob = toBlob;
      await expect(
        renderScenePng(sceneWithRotation(), {
          createCanvas: () => failing.canvas,
        }),
      ).rejects.toThrow();
    }
  });
});

function sceneWithRotation(): SceneModel {
  return {
    ...snapshotScene,
    words: [{ ...snapshotScene.words[0], angle: 90 }],
  };
}
