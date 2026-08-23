import type { ProgressInfo } from "./transformers.js";

/**
 * Map a Transformers.js `progress_callback` event onto IPA
 * `onDownloadProgress` (`0…1`).
 *
 * Prefers end-to-end `progress_total` (0–100, or already 0–1). Falls back to
 * aggregating per-file `progress` `loaded`/`total` so the bar keeps moving
 * when `progress_total` is sparse.
 */
export function loadedFromProgress(
  info: ProgressInfo | undefined,
  files?: Map<string, { loaded: number; total: number }>
): number | undefined {
  if (info == null || typeof info !== "object") return undefined;
  const status = info.status;
  if (status === "ready") return 1;
  if (status === "progress_total") {
    return normalizeFraction(info.progress);
  }
  if (
    (status === "progress" || status === "download") &&
    typeof info.loaded === "number" &&
    typeof info.total === "number" &&
    info.total > 0
  ) {
    if (files) {
      const key = info.file ?? "_";
      files.set(key, { loaded: info.loaded, total: info.total });
      let loaded = 0;
      let total = 0;
      for (const file of files.values()) {
        loaded += file.loaded;
        total += file.total;
      }
      return total > 0 ? clamp01(loaded / total) : undefined;
    }
    return clamp01(info.loaded / info.total);
  }
  return undefined;
}

export function createProgressAggregator(): (
  info: ProgressInfo | undefined
) => number | undefined {
  const files = new Map<string, { loaded: number; total: number }>();
  return (info) => loadedFromProgress(info, files);
}

function normalizeFraction(progress: number | undefined): number | undefined {
  if (typeof progress !== "number" || !Number.isFinite(progress)) {
    return undefined;
  }
  return progress > 1 ? clamp01(progress / 100) : clamp01(progress);
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
