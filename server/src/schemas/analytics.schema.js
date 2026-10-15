import { z } from 'zod';

/**
 * Validates analytics dashboard query parameters.
 * Provides date-range filtering, executive scoping, and source slicing.
 */
export const analyticsQuerySchema = z.object({
  preset: z
    .enum(['all', 'today', '7d', '30d', 'custom'], {
      errorMap: () => ({ message: 'Preset must be one of: all, today, 7d, 30d, custom' }),
    })
    .optional()
    .default('30d'),
  startDate: z
    .string()
    .trim()
    .optional()
    .refine((val) => !val || !isNaN(Date.parse(val)), {
      message: 'Invalid startDate format',
    }),
  endDate: z
    .string()
    .trim()
    .optional()
    .refine((val) => !val || !isNaN(Date.parse(val)), {
      message: 'Invalid endDate format',
    }),
  assignedTo: z
    .string()
    .trim()
    .optional()
    .refine(
      (val) => !val || val === 'all' || val === 'unassigned' || /^[0-9a-fA-F]{24}$/.test(val),
      {
        message: 'Invalid assignedTo user ID or value format',
      }
    ),
  source: z.string().trim().optional(),
});
