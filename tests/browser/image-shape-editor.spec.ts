import { deflateSync } from "node:zlib";
import { expect, test } from "@playwright/test";
import { advanceWizard, openWizard } from "./wizard-helpers";

type Pixel = readonly [red: number, green: number, blue: number, alpha: number];

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, "ascii");
  const contents = Buffer.concat([typeBytes, data]);
  const length = Buffer.alloc(4);
  const checksum = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  checksum.writeUInt32BE(crc32(contents), 0);
  return Buffer.concat([length, contents, checksum]);
}

function solidPng(width: number, height: number, pixel: Pixel): Buffer {
  const scanlines = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (1 + width * 4);
    scanlines[rowStart] = 0;
    for (let x = 0; x < width; x += 1)
      pixel.forEach(
        (channel, index) => (scanlines[rowStart + 1 + x * 4 + index] = channel),
      );
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(scanlines)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

test("foreground and background marks refine a photo selection before confirmation", async ({
  page,
}) => {
  await openWizard(page);
  await page.locator("#source-text").fill("foreground foreground background");
  await advanceWizard(page, "words");
  await advanceWizard(page, "style");
  await page.getByRole("tab", { name: "上傳圖片", exact: true }).click();

  const editor = page.locator(".image-shape-editor");
  await editor.getByLabel("上傳圖片").setInputFiles({
    name: "plain-background.png",
    mimeType: "image/png",
    buffer: solidPng(9, 9, [255, 255, 255, 255]),
  });

  const canvas = editor.getByRole("img", { name: /^要保留的前景:/ });
  await expect(canvas).toHaveAttribute("aria-label", /\/ 81$/);
  await expect(canvas).toHaveAttribute("aria-label", "要保留的前景: 0 / 81");

  const radius = editor.locator('input[type="range"]').first();
  await radius.press("Home");
  await expect(radius).toHaveValue("1");

  const brushCoordinates = editor
    .locator(".image-shape-coordinate-row")
    .first();
  const paintAt = async (tool: string, x: number, y: number) => {
    await editor.getByRole("button", { name: tool, exact: true }).click();
    await brushCoordinates.getByLabel("X").fill(String(x));
    await brushCoordinates.getByLabel("Y").fill(String(y));
    await brushCoordinates
      .getByRole("button", { name: "在座標繪製", exact: true })
      .click();
  };
  const pixelAt = (x: number, y: number) =>
    canvas.evaluate(
      (element, point) => {
        const context = (element as HTMLCanvasElement).getContext("2d");
        if (!context)
          throw new Error("Foreground preview canvas is unavailable.");
        return Array.from(context.getImageData(point.x, point.y, 1, 1).data);
      },
      { x, y },
    );

  await paintAt("前景標記", 3, 4);
  await expect.poll(() => pixelAt(3, 4)).toEqual([58, 211, 126, 255]);
  await paintAt("背景標記", 5, 4);
  await expect.poll(() => pixelAt(5, 4)).toEqual([238, 91, 166, 255]);

  await editor.getByRole("button", { name: "尋找主體", exact: true }).click();
  await expect
    .poll(async () => {
      const label = await canvas.getAttribute("aria-label");
      return Number(label?.match(/^要保留的前景: (\d+) \/ 81$/)?.[1] ?? 0);
    })
    .toBeGreaterThan(0);

  await editor.getByRole("button", { name: "確認前景", exact: true }).click();
  await expect(editor.getByText(/儲存的前景：9 × 9 像素/)).toBeVisible();
  await expect(
    editor.getByRole("button", { name: "確認前景", exact: true }),
  ).toBeHidden();
});
