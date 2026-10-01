import { z } from 'zod';
export const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid identifier');
export const pagination = z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(20) });
export const authRegister = z.object({ body: z.object({ name: z.string().trim().min(2).max(120).optional(), email: z.string().email(), password: z.string().min(8).max(128) }).strict() });
export const authLogin = z.object({ body: z.object({ email: z.string().email(), password: z.string().min(1).max(128) }) });
export const refreshSchema = z.object({ body: z.object({ refreshToken: z.string().min(20).max(500) }) });
export const idParam = z.object({ params: z.object({ id: objectId }) });
