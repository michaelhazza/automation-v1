import { z } from 'zod';

// POST /api/users/invite
export const inviteUserBody = z.object({
  email: z.string().email().max(255),
  role: z.string().min(1).max(100),
  firstName: z.string().max(255).optional(),
  lastName: z.string().max(255).optional(),
});
export type InviteUserInput = z.infer<typeof inviteUserBody>;

// POST /api/users/create-member
export const createMemberBody = z.object({
  email: z.string().email().max(255),
  firstName: z.string().min(1).max(255),
  lastName: z.string().min(1).max(255),
  role: z.string().max(100).optional(),
});
export type CreateMemberInput = z.infer<typeof createMemberBody>;

// PATCH /api/users/me
const updateProfileBase = z.object({
  firstName: z.string().min(1).max(255),
  lastName: z.string().min(1).max(255),
  currentPassword: z.string().min(1).max(500),
  newPassword: z.string().min(8).max(500),
});
export const updateProfileBody = updateProfileBase.partial().refine(
  obj => Object.keys(obj).length > 0,
  { message: 'At least one field must be provided' }
);
export type UpdateProfileInput = z.infer<typeof updateProfileBody>;

// PATCH /api/users/:id
const updateUserBase = z.object({
  role: z.string().min(1).max(100),
  status: z.string().min(1).max(50),
  firstName: z.string().min(1).max(255),
  lastName: z.string().min(1).max(255),
});
export const updateUserBody = updateUserBase.partial().refine(
  obj => Object.keys(obj).length > 0,
  { message: 'At least one field must be provided' }
);
export type UpdateUserInput = z.infer<typeof updateUserBody>;
