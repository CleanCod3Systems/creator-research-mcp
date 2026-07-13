import { z } from "zod";

export const JobStatus = z.enum(["queued", "running", "done", "failed", "failed_with_guidance"]);
export type JobStatus = z.infer<typeof JobStatus>;

export const JobProgress = z.object({
  stage: z.string().optional(),
  percent: z.number().min(0).max(100).default(0),
  message: z.string().optional(),
});
export type JobProgress = z.infer<typeof JobProgress>;
