import {
  decodeSnapshotFragment,
  encodeSnapshot,
  type Presentation,
  type SnapshotPayload,
} from "./snapshot";
import { LIMITS, utf8ByteLength } from "./limits";
import type { SceneModel } from "./scene";
import type { WordSet } from "./types";

export const SNAPSHOT_FILE_EXTENSION = ".wc";

export function encodeSnapshotFile(
  wordSet: WordSet,
  presentation: Presentation,
  scene: SceneModel,
): Uint8Array {
  const fragment = encodeSnapshot(
    wordSet,
    presentation,
    scene,
    LIMITS.maxSnapshotFileBytes,
  ).fragment;
  const bytes = new TextEncoder().encode(fragment);
  if (bytes.byteLength > LIMITS.maxSnapshotFileBytes)
    throw new Error(
      `snapshot file exceeds ${LIMITS.maxSnapshotFileBytes} bytes`,
    );
  return bytes;
}

export function decodeSnapshotFile(
  data: Uint8Array | ArrayBuffer,
): SnapshotPayload {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.byteLength > LIMITS.maxSnapshotFileBytes)
    throw new Error(
      `snapshot file exceeds ${LIMITS.maxSnapshotFileBytes} bytes`,
    );
  let fragment: string;
  try {
    fragment = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("snapshot file is not valid UTF-8");
  }
  if (utf8ByteLength(fragment) !== bytes.byteLength)
    throw new Error("snapshot file contains invalid encoding");
  return decodeSnapshotFragment(fragment, LIMITS.maxSnapshotFileBytes);
}
