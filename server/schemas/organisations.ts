import { z } from 'zod';

// POST /api/organisations
export const createOrganisationBody = z.object({
  name: z.string().min(1).max(255),
  slug: z.string().min(1).max(100),
  plan: z.string().min(1).max(100),
  adminEmail: z.string().email().max(255),
  adminFirstName: z.string().min(1).max(255),
  adminLastName: z.string().min(1).max(255),
});
export type CreateOrganisationInput = z.infer<typeof createOrganisationBody>;

// PATCH /api/organisations/:id
const updateOrganisationBase = z.object({
  name: z.string().min(1).max(255),
  slug: z.string().min(1).max(100),
  plan: z.string().min(1).max(100),
  status: z.string().min(1).max(50),
});
export const updateOrganisationBody = updateOrganisationBase.partial().refine(
  obj => Object.keys(obj).length > 0,
  { message: 'At least one field must be provided' }
);
export type UpdateOrganisationInput = z.infer<typeof updateOrganisationBody>;
