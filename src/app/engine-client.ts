import type { EncodedJsonFragment } from "../core/codec";
import {
  type LayoutOptions,
  type LayoutStyle,
  layoutWordCloud,
} from "../core/layout";
import type { FontMetricsTable } from "../core/metrics";
import type { SceneModel } from "../core/scene";
import type { SnapshotPayload } from "../core/snapshot";
import type { WordSet } from "../core/types";

export interface GenerateRequest {
  type: "generate";
  jobId: number;
  wordSet: WordSet;
  style: LayoutStyle;
  metrics: FontMetricsTable;
}

export interface CancelRequest {
  type: "cancel";
  jobId: number;
}

export interface ShareEncodeRequest {
  type: "share-encode";
  jobId: number;
  value: unknown;
}

export interface ShareDecodeRequest {
  type: "share-decode";
  jobId: number;
  fragment: string;
}

export type EngineRequest =
  | GenerateRequest
  | ShareEncodeRequest
  | ShareDecodeRequest
  | CancelRequest;

export type EngineResponse =
  | { type: "success"; jobId: number; scene: SceneModel }
  | { type: "share-encoded"; jobId: number; encoded: EncodedJsonFragment }
  | { type: "share-decoded"; jobId: number; snapshot: SnapshotPayload }
  | { type: "error"; jobId: number; message: string }
  | { type: "cancelled"; jobId: number };

export interface WorkerLike {
  onerror?: ((event: ErrorEvent) => void) | null;
  onmessageerror?: ((event: MessageEvent) => void) | null;
  postMessage(message: EngineRequest): void;
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<EngineResponse>) => void,
  ): void;
  removeEventListener(
    type: "message",
    listener: (event: MessageEvent<EngineResponse>) => void,
  ): void;
  terminate?(): void;
}

export interface LayoutInput {
  wordSet: WordSet;
  style: LayoutStyle;
  metrics: FontMetricsTable;
}

export class EngineClient {
  private static readonly JOB_TIMEOUT_MS = 10_000;
  private static readonly SHARE_JOB_TIMEOUT_MS = 30_000;
  private nextJobId = 0;
  private active:
    | {
        jobId: number;
        reject: (error: Error) => void;
        listener: (event: MessageEvent<EngineResponse>) => void;
        timeoutId: ReturnType<typeof setTimeout>;
      }
    | undefined;

  public constructor(private readonly worker: WorkerLike) {
    this.worker.onerror = () => {
      this.rejectActive(new Error("layout worker failed"));
    };
    this.worker.onmessageerror = () => {
      this.rejectActive(new Error("layout worker message failed"));
    };
  }

  private rejectActive(error: Error): void {
    const active = this.active;
    if (!active) return;
    this.active = undefined;
    this.worker.removeEventListener("message", active.listener);
    clearTimeout(active.timeoutId);
    active.reject(error);
  }

  private request(
    input:
      | Omit<GenerateRequest, "jobId">
      | Omit<ShareEncodeRequest, "jobId">
      | Omit<ShareDecodeRequest, "jobId">,
    expectedType: "success" | "share-encoded" | "share-decoded",
    timeoutMs = EngineClient.JOB_TIMEOUT_MS,
  ): Promise<EngineResponse> {
    const jobId = ++this.nextJobId;
    if (this.active) {
      const active = this.active;
      this.rejectActive(new Error("superseded by a newer engine job"));
      try {
        this.worker.postMessage({ type: "cancel", jobId: active.jobId });
      } catch {
        // The active promise is already rejected; a dead worker needs no retry.
      }
    }

    return new Promise<EngineResponse>((resolve, reject) => {
      const listener = (event: MessageEvent<EngineResponse>) => {
        if (event.data.jobId !== jobId) return;
        const active = this.active;
        if (active?.jobId !== jobId) return;
        this.active = undefined;
        this.worker.removeEventListener("message", listener);
        clearTimeout(active.timeoutId);
        if (event.data.type === "error") {
          reject(new Error(event.data.message));
        } else if (event.data.type === "cancelled") {
          reject(new Error("engine job cancelled"));
        } else if (event.data.type === expectedType) {
          resolve(event.data);
        } else {
          reject(new Error("engine worker returned an unexpected response"));
        }
      };
      const timeoutId = setTimeout(() => {
        if (this.active?.jobId !== jobId) return;
        this.rejectActive(new Error("engine worker timed out"));
      }, timeoutMs);
      this.active = { jobId, reject, listener, timeoutId };
      try {
        this.worker.addEventListener("message", listener);
        this.worker.postMessage({ ...input, jobId });
      } catch (error) {
        this.rejectActive(
          error instanceof Error ? error : new Error("engine worker failed"),
        );
      }
    });
  }

  public async submit(input: LayoutInput): Promise<SceneModel> {
    const response = await this.request(
      { type: "generate", ...input },
      "success",
    );
    if (response.type !== "success") {
      throw new Error("engine worker returned an unexpected response");
    }
    return response.scene;
  }

  public async encodeShare(value: unknown): Promise<EncodedJsonFragment> {
    const response = await this.request(
      { type: "share-encode", value },
      "share-encoded",
      EngineClient.SHARE_JOB_TIMEOUT_MS,
    );
    if (response.type !== "share-encoded") {
      throw new Error("engine worker returned an unexpected response");
    }
    return response.encoded;
  }

  public async decodeShare(fragment: string): Promise<SnapshotPayload> {
    const response = await this.request(
      { type: "share-decode", fragment },
      "share-decoded",
      EngineClient.SHARE_JOB_TIMEOUT_MS,
    );
    if (response.type !== "share-decoded") {
      throw new Error("engine worker returned an unexpected response");
    }
    return response.snapshot;
  }

  public cancel(): void {
    if (!this.active) return;
    const active = this.active;
    this.rejectActive(new Error("layout job cancelled"));
    try {
      this.worker.postMessage({ type: "cancel", jobId: active.jobId });
    } catch {
      // The active promise is already rejected; a dead worker needs no retry.
    }
  }

  public dispose(): void {
    this.cancel();
    this.worker.onerror = null;
    this.worker.onmessageerror = null;
    this.worker.terminate?.();
  }
}

export function createBrowserEngineClient(): EngineClient | null {
  if (typeof Worker === "undefined") return null;
  try {
    const worker = new Worker(
      new URL("../workers/engine.worker.ts", import.meta.url),
      {
        type: "module",
      },
    );
    return new EngineClient(worker);
  } catch {
    return null;
  }
}

export function runLayoutFallback(
  input: LayoutInput,
  options: LayoutOptions = {},
): SceneModel {
  return layoutWordCloud(input.wordSet, input.style, input.metrics, options);
}
