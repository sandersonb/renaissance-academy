import { z } from 'zod';
import { registerSchema } from '../services/authService.js';

const password = (minimum: number, maximumBytes: number) => z.string().min(minimum).max(maximumBytes)
  .refine((value) => Buffer.byteLength(value, 'utf8') <= maximumBytes, `Password must be at most ${maximumBytes} UTF-8 bytes.`);
const token = z.string().regex(/^[a-f0-9]{32}$/, 'Invalid token format.');
const email = z.string().email().max(128);
const username = (maximum: number) => z.string().min(1).max(maximum);
const schemas: Record<string, z.ZodTypeAny> = {
  '/api/auth/register': registerSchema,
  '/api/auth/login': z.object({ username: username(32), password: password(1, 1024) }).strict(),
  '/api/admin/login': z.object({ username: username(64), password: password(1, 1024) }).strict(),
  '/api/auth/forgot': z.object({ username: username(32), email }).strict(),
  '/api/auth/resend': z.object({ email }).strict(),
  '/api/auth/reset': z.object({ token, password: password(6, 72) }).strict(),
  '/api/auth/confirm': z.object({ token }).strict(),
  '/api/auth/confirm/answer': z.object({ token, titleId: z.coerce.number().int().positive(), answer: z.string().max(4096).optional(), answers: z.array(z.string().max(4096)).max(50).optional() }).strict(),
  '/api/admin/admins': z.object({ username: z.string().regex(/^\w{3,64}$/), password: password(8, 72) }).strict(),
};
export const boundedAuthPath = (path: string) => Object.hasOwn(schemas, path);
export function validateAuthBody(path: string, body: unknown): unknown { return schemas[path]?.parse(body) ?? body; }
