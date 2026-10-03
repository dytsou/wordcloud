import { detectForeground, segmentSubject } from "../core/image-segmentation";
import type {
  ImageProcessingJob,
  ImageProcessingResult,
} from "./image-processing";

const worker = globalThis as typeof globalThis & {
  onmessage: ((event: MessageEvent<ImageProcessingJob>) => void) | null;
  postMessage(value: ImageProcessingResult, transfer: Transferable[]): void;
};
worker.onmessage = (event) => {
  try {
    const job = event.data;
    if (job.kind !== "foreground" && job.kind !== "subject")
      throw new TypeError("Unsupported image processing task.");
    const mask =
      job.kind === "foreground"
        ? detectForeground(
            job.raster,
            job.options.tolerance,
            job.options.includeEnclosedBackground,
          )
        : segmentSubject(job.raster, job.options);
    worker.postMessage({ ok: true, mask }, [mask.buffer]);
  } catch (error) {
    worker.postMessage(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : "Image processing failed.",
      },
      [],
    );
  }
};
