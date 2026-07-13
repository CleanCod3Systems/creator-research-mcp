import type { JobProgress, JobStatus } from "../domain/jobs.js";

export interface JobRecord<TPayload = unknown> {
  id: string;
  type: string;
  payload: TPayload;
  status: JobStatus;
  progress: JobProgress;
  attempts: number;
  lastError?: string;
  resultId?: string;
  createdAt: string;
}

export interface JobQueue {
  enqueue(type: string, payload: unknown): Promise<string>;
  get(jobId: string): Promise<JobRecord | null>;
  /** Reclama el próximo job pendiente (para el worker). */
  claimNext(types: string[]): Promise<JobRecord | null>;
  update(
    jobId: string,
    patch: Partial<Pick<JobRecord, "status" | "progress" | "lastError" | "resultId">>,
  ): Promise<void>;
}
