import { z } from 'zod';

export const createUserSchema = z.object({
  name: z
    .string({ required_error: 'Name is required' })
    .trim()
    .min(2, 'Name must be at least 2 characters long')
    .max(100, 'Name cannot exceed 100 characters'),
  email: z
    .string({ required_error: 'Email is required' })
    .trim()
    .email('Please provide a valid email address'),
  password: z
    .string({ required_error: 'Password is required' })
    .min(8, 'Password must be at least 8 characters long'),
  role: z
    .enum(['admin', 'sales_executive'], {
      errorMap: () => ({ message: 'Role must be either admin or sales_executive' }),
    })
    .default('sales_executive'),
});

export const updateUserSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Name must be at least 2 characters long')
    .max(100, 'Name cannot exceed 100 characters')
    .optional(),
  role: z
    .enum(['admin', 'sales_executive'], {
      errorMap: () => ({ message: 'Role must be either admin or sales_executive' }),
    })
    .optional(),
});

export const updateStatusSchema = z.object({
  isActive: z.boolean({ required_error: 'isActive must be a boolean' }),
});
