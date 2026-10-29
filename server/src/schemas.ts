/** zod validation of request bodies, type-checked against the shared contract. */

import { z } from 'zod';
import type { AuthLoginRequest, AuthResetRequest, AuthResetStartRequest, AuthSignupRequest, AuthSignupStartRequest, GenerateRequest } from '../../shared/contract.js';

const email = z.string().trim().toLowerCase().email().max(254);

const password = z.string().min(8).max(128);
const turn = z.object({ role: z.enum(['user', 'model']), text: z.string().max(20_000) }).strict();

export const authSignupStartSchema = z
  .object({
    email,
  })
  .strict() satisfies z.ZodType<AuthSignupStartRequest>;

export const authSignupSchema = z
  .object({
    email,
    code: z.string().trim().regex(/^\d{6}$/),
    password,
  })
  .strict() satisfies z.ZodType<AuthSignupRequest>;

export const authResetStartSchema = z
  .object({
    email,
  })
  .strict() satisfies z.ZodType<AuthResetStartRequest>;

export const authResetSchema = z
  .object({
    email,
    code: z.string().trim().regex(/^\d{6}$/),
    password,
  })
  .strict() satisfies z.ZodType<AuthResetRequest>;

export const authLoginSchema = z
  .object({
    email,
    password,
  })
  .strict() satisfies z.ZodType<AuthLoginRequest>;

export const generateSchema = z
  .object({
    kind: z.enum(['chat', 'preset']),
    question: z.string().min(1).max(20_000),
    history: z.array(turn).max(60).optional(),
    related_chats: z
      .array(z.object({ course: z.string().max(200), turns: z.array(turn).max(60) }).strict())
      .max(10)
      .optional(),
    context_markdown: z.string().max(1_000_000).optional(),
    answer_mode: z.enum(['course', 'general']).optional(),
    max_output_tokens: z.number().int().positive().max(100_000).optional(),
    client: z.object({
      version: z.string().max(32),
      locale: z.string().max(16).optional(),
      brightspace_host: z.string().max(253).optional(),
    }),
  })
  .strict() satisfies z.ZodType<GenerateRequest>;
