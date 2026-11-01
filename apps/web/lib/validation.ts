import { z } from "zod";

/*
 * Client-side validation for the register/login shells. The auth wave's server
 * endpoints re-state these rules authoritatively — these schemas are the UI
 * mirror, not the source of truth.
 */

export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Enter a valid email address."),
  password: z.string().min(10, "Passwords are at least 10 characters."),
});

export type LoginForm = z.infer<typeof loginSchema>;

export const registerRoles = ["student", "parent", "educator"] as const;
export type RegisterRole = (typeof registerRoles)[number];

export const registerRoleLabels: Record<RegisterRole, string> = {
  student: "Student",
  parent: "Parent",
  educator: "Educator",
};

export const registerSchema = z
  .object({
    name: z.string().trim().min(1, "Tell us what to call you.").max(80),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .email("Enter a valid email address."),
    password: z.string().min(10, "Passwords are at least 10 characters."),
    confirmPassword: z.string(),
    role: z.enum(registerRoles, {
      message: "Choose the role that fits you.",
    }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match.",
    path: ["confirmPassword"],
  });

export type RegisterForm = z.infer<typeof registerSchema>;

/** Flatten a ZodError into a per-field message map for inline display. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path[0];
    if (typeof key === "string" && !(key in out)) {
      out[key] = issue.message;
    }
  }
  return out;
}
