import type { ColumnMapping } from "./csv.ts";
import type { WorkerDone, WorkerError, WorkerProgress, WorkerRequest } from "../worker/importWorker.ts";

export interface ImportJobResult extends WorkerDone {
  filename: string;
  bytes: number;
  sha256: string;
}

export interface ProgressCallback {
  (done: number, total: number): void;
}

let workerInstance: Worker | null = null;

function getWorker(): Worker | null {
  try {
    if (!workerInstance) {
      workerInstance = new Worker(new URL("../worker/importWorker.ts", import.meta.url), { type: "module" });
    }
    return workerInstance;
  } catch {
    return null;
  }
}

export function terminateWorker(): void {
  try {
    workerInstance?.terminate();
  } catch {
    void 0;
  }
  workerInstance = null;
}

export async function runImportInWorker(
  req: Omit<WorkerRequest, "jobId">,
  meta: { filename: string; bytes: number; sha256: string },
  onProgress: ProgressCallback,
  signal?: AbortSignal,
): Promise<ImportJobResult> {
  const worker = getWorker();
  if (!worker) throw new Error("worker unavailable");
  const jobId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  return new Promise((resolve, reject) => {
    const onMessage = (ev: MessageEvent<WorkerProgress | WorkerDone | WorkerError>) => {
      const msg = ev.data;
      if (!msg || msg.jobId !== jobId) return;
      if (msg.type === "progress") onProgress(msg.done, msg.total);
      else if (msg.type === "done") {
        cleanup();
        resolve({ ...msg, filename: meta.filename, bytes: meta.bytes, sha256: meta.sha256 });
      } else {
        cleanup();
        reject(new Error(msg.message));
      }
    };
    const onAbort = () => {
      cleanup();
      terminateWorker();
      reject(new Error("cancelled"));
    };
    const cleanup = () => {
      worker.removeEventListener("message", onMessage);
      signal?.removeEventListener("abort", onAbort);
    };
    worker.addEventListener("message", onMessage);
    signal?.addEventListener("abort", onAbort);
    worker.postMessage({ ...req, jobId });
  });
}

export type { ColumnMapping };
