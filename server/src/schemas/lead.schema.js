import { z } from 'zod';

export const LEAD_STATUSES = ['new', 'contacted', 'follow_up', 'qualified', 'lost', 'converted'];

/**
 * Strict CRM lifecycle status transitions graph.
 * Supports bidirectional movement between adjacent stages and proper drop-off to lost.
 */
export const ALLOWED_STATUS_TRANSITIONS = {
  new: ['contacted', 'follow_up', 'qualified', 'lost'],
  contacted: ['follow_up', 'qualified', 'lost', 'new'],
  follow_up: ['qualified', 'contacted', 'lost', 'new'],
  qualified: ['converted', 'lost', 'follow_up', 'contacted'],
  lost: ['contacted', 'follow_up', 'qualified', 'new'],
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
  followUpStatus: z
    .enum(['all', 'overdue', 'today', 'upcoming', 'scheduled', 'none'])
    .optional()
    .default('all'),
  sortBy: z
    .enum(['createdAt', 'leadCreatedAt', 'fullName', 'status', 'nextFollowUpDate'])
    .optional()
    .default('createdAt'),
  sortOrder: z
    .enum(['asc', 'desc'])
    .optional()
    .default('desc'),
});

/**
 * Validates lead status transition request body.
 * Accepts target status, optional stage change note, and optional lost reason.
 */
export const updateLeadStatusSchema = z.object({
  status: z.enum(LEAD_STATUSES, {
    errorMap: () => ({
      message: `Status must be one of: ${LEAD_STATUSES.join(', ')}`,
    }),
  }),
  note: z
    .string()
    .trim()
    .max(1000, 'Stage note cannot exceed 1000 characters')
    .optional()
    .default(''),
  reason: z
    .string()
    .trim()
    .max(200, 'Reason cannot exceed 200 characters')
    .optional()
    .default(''),
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

/**
 * Validates scheduling or rescheduling a sales follow-up.
 */
export const scheduleFollowUpSchema = z.object({
  followUpDate: z
    .string({
      required_error: 'Follow-up date and time is required',
    })
    .trim()
    .refine((val) => !isNaN(Date.parse(val)), {
      message: 'Invalid follow-up date and time format',
    })
    .refine((val) => new Date(val).getTime() >= Date.now() - 5 * 60 * 1000, {
      message: 'Follow-up date and time must be in the future',
    }),
  remarks: z
    .string()
    .trim()
    .max(500, 'Follow-up remarks cannot exceed 500 characters')
    .optional()
    .default(''),
});

/**
 * Validates completing a scheduled follow-up.
 */
export const completeFollowUpSchema = z.object({
  notes: z
    .string()
    .trim()
    .max(2000, 'Follow-up completion notes cannot exceed 2000 characters')
    .optional()
    .default(''),
});

/**
 * Validates creating an activity log entry.
 */
export const createActivitySchema = z.object({
  type: z.enum(['call', 'whatsapp', 'meeting', 'email', 'note'], {
    errorMap: () => ({
      message: 'Activity type must be one of: call, whatsapp, meeting, email, note',
    }),
  }),
  summary: z
    .string({
      required_error: 'Activity summary or description is required',
    })
    .trim()
    .min(1, 'Activity notes cannot be empty')
    .max(2000, 'Activity notes cannot exceed 2000 characters'),
  metadata: z.record(z.any()).optional().default({}),
});
