import { z } from "zod";

const BRANCH_CODE_REGEX = /^[A-Z0-9][A-Z0-9_-]{1,19}$/;

export const createBranchSchema = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(
        BRANCH_CODE_REGEX,
        "Branch code must be 2-20 uppercase alphanumeric, underscore, or hyphen characters",
      ),
    name: z.string().trim().min(2).max(120),
    address: z.string().trim().max(300).optional().nullable(),
    phone: z.string().trim().min(8).max(20).optional().nullable(),
    isDefault: z.boolean().default(false),
  })
  .strict();

export const updateBranchSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    address: z.string().trim().max(300).optional().nullable(),
    phone: z.string().trim().min(8).max(20).optional().nullable(),
    isDefault: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided for update",
  });

export type CreateBranchInput = z.infer<typeof createBranchSchema>;
export type UpdateBranchInput = z.infer<typeof updateBranchSchema>;

export interface BranchItem {
  id: string;
  code: string;
  name: string;
  address: string | null;
  phone: string | null;
  isDefault: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BranchListResponse {
  items: BranchItem[];
  quota: {
    activeCount: number;
    maxBranches: number;
  };
}
