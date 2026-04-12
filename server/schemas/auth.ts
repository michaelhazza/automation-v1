import { z } from 'zod';

export const loginBody = z.object({
  email: z.string().email().max(255),
  password: z.string().min(1).max(500),
  organisationSlug: z.string().max(100).optional(),
});
export type LoginInput = z.infer<typeof loginBody>;

export const acceptInviteBody = z.object({
  token: z.string().min(1),
  password: z.string().min(8).max(500),
  firstName: z.string().min(1).max(255),
  lastName: z.string().min(1).max(255),
});
export type AcceptInviteInput = z.infer<typeof acceptInviteBody>;

export const forgotPasswordBody = z.object({
  email: z.string().email().max(255),
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordBody>;

export const resetPasswordBody = z.object({
  token: z.string().min(1),
  password: z.string().min(8).max(500),
});
export type ResetPasswordInput = z.infer<typeof resetPasswordBody>;

export const signupBody = z.object({
  agencyName: z.string().min(1).max(255).trim(),
  email: z.string().email().max(255),
  password: z.string().min(8).max(500),
});
export type SignupInput = z.infer<typeof signupBody>;
