import { z } from 'zod';

export const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'lost', 'converted'];

/**
 * Strict CRM lifecycle status transitions graph.
 */
export const ALLOWED_STATUS_TRANSITIONS = {
  new: ['contacted', 'qualified', 'lost'],
  contacted: ['qualified', 'lost', 'new'],
  qualified: ['converted', 'lost', 'contacted'],
  lost: ['contacted', 'qualified', 'new'],
  converted: ['qualified'],
};

/**
 * Validates lead listing query parameters.
 */
export const leadQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(50, 'Page limit cannot exceed 50').default(10),
  status: z
    .enum([...LEAD_STATUSES, 'all'])
    .optional()
    .default('all'),
  assignedTo: z.string().trim().optional(),
  source: z.string().trim().optional(),
  search: z.string().trim().max(100, 'Search term too long').optional(),
  startDate: z.string().trim().optional(),
  endDate: z.string().trim().optional(),
  sortBy: z
    .enum(['createdAt', 'leadCreatedAt', 'fullName', 'status'])
    .optional()
    .default('createdAt'),
  sortOrder: z
    .enum(['asc', 'desc'])
    .optional()
    .default('desc'),
});

/**
 * Validates lead status transition request body.
 */
export const updateLeadStatusSchema = z.object({
  status: z.enum(LEAD_STATUSES, {
    errorMap: () => ({
      message: `Status must be one of: ${LEAD_STATUSES.join(', ')}`,
    }),
  }),
});

/**
 * Validates lead assignment request body.
 * Allows valid 24-character hex MongoDB ObjectId or null (to unassign).
 */
export const assignLeadSchema = z.object({
  assignedTo: z
    .string()
    .trim()
    .regex(/^[0-9a-fA-F]{24}$/, 'Invalid user ID format for assignment')
    .nullable(),
});
