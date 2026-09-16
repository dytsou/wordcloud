/** Runs inside the browser via locator.evaluate; deliberately tests SVG, not layout masks. */
export async function paintedOverlaps(element: Element): Promise<number> {
  const root = element as SVGSVGElement;
  const width = root.viewBox.baseVal.width;
  const height = root.viewBox.baseVal.height;
  const occupied = new Uint8Array(width * height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d")!;
  let overlaps = 0;
  for (const text of root.querySelectorAll("text")) {
    const standalone = root.cloneNode(false) as SVGSVGElement;
    standalone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    standalone.setAttribute("width", String(width));
    standalone.setAttribute("height", String(height));
    standalone.append(text.cloneNode(true));
    const url = URL.createObjectURL(
      new Blob([new XMLSerializer().serializeToString(standalone)], {
        type: "image/svg+xml",
      }),
    );
    const img = new Image();
    try {
      img.src = url;
      await img.decode();
      context.clearRect(0, 0, width, height);
      context.drawImage(img, 0, 0);
      const pixels = context.getImageData(0, 0, width, height).data;
      for (let i = 0; i < occupied.length; i++) {
        if (pixels[i * 4 + 3] > 32) {
          if (occupied[i]) overlaps++;
          occupied[i] = 1;
        }
      }
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  return overlaps;
}
