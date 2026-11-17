import { z } from "zod";
import { PERMISSIONS, ROLES } from "../permissions";
import { uuidSchema } from "./common";

const EMPLOYEE_CODE_REGEX = /^[A-Z0-9][A-Z0-9_-]{1,31}$/;
const PERMISSION_VALUES = Object.values(PERMISSIONS) as [
  (typeof PERMISSIONS)[keyof typeof PERMISSIONS],
  ...(typeof PERMISSIONS)[keyof typeof PERMISSIONS][],
];

export const permissionOverridesSchema = z
  .object({
    grant: z.array(z.enum(PERMISSION_VALUES)).optional(),
    revoke: z.array(z.enum(PERMISSION_VALUES)).optional(),
  })
  .strict();

export const createStaffMemberSchema = z
  .object({
    fullName: z.string().trim().min(2).max(100),
    employeeCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(
        EMPLOYEE_CODE_REGEX,
        "Employee code must be 2-32 uppercase alphanumeric, underscore, or hyphen characters",
      ),
    role: z.enum(ROLES),
    email: z.string().trim().toLowerCase().email().max(254).optional().nullable(),
    password: z.string().min(8).max(128).optional().nullable(),
    pin: z
      .string()
      .trim()
      .regex(/^\d{4,8}$/, "PIN must be 4 to 8 digits")
      .optional()
      .nullable(),
    phone: z.string().trim().min(8).max(20).optional().nullable(),
    allowedBranchIds: z.array(uuidSchema).default([]),
    permissions: permissionOverridesSchema.optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.password && !data.email) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["email"],
        message: "Email is required when password is set",
      });
    }
    if (data.email && !data.password) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["password"],
        message: "Password is required when email login is enabled",
      });
    }
    if (!data.email && !data.pin) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["pin"],
        message: "Either email+password or cashier PIN must be provided",
      });
    }
  });

export const updateStaffMemberSchema = z
  .object({
    fullName: z.string().trim().min(2).max(100).optional(),
    role: z.enum(ROLES).optional(),
    pin: z
      .string()
      .trim()
      .regex(/^\d{4,8}$/, "PIN must be 4 to 8 digits")
      .optional()
      .nullable(),
    phone: z.string().trim().min(8).max(20).optional().nullable(),
    allowedBranchIds: z.array(uuidSchema).optional(),
    permissions: permissionOverridesSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided for update",
  });

export type CreateStaffMemberInput = z.infer<typeof createStaffMemberSchema>;
export type UpdateStaffMemberInput = z.infer<typeof updateStaffMemberSchema>;
export type PermissionOverridesInput = z.infer<
  typeof permissionOverridesSchema
>;

export interface StaffMemberItem {
  id: string;
  userId: string;
  employeeCode: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  role: (typeof ROLES)[number];
  hasPin: boolean;
  allowedBranchIds: string[];
  permissions: PermissionOverridesInput;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StaffListResponse {
  items: StaffMemberItem[];
  quota: {
    activeCount: number;
    maxUsers: number;
  };
}
