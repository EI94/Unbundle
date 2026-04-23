import { z } from "zod";
import {
  USE_CASE_CATEGORIES,
  USE_CASE_STATUSES,
} from "@/lib/use-case-lifecycle";

export const patchUseCaseStatusBodySchema = z.object({
  status: z.enum(USE_CASE_STATUSES),
});

export const patchUseCaseWaveBodySchema = z.object({
  category: z.enum(USE_CASE_CATEGORIES),
});
