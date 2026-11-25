import { z } from 'zod'

export const copyTextInputSchema = z.string().min(1).max(8192)
export const openPathInputSchema = z.string().min(1).max(1024)
export const sessionIdSchema = z.string().min(1).max(200)
export const sessionPolicyPatchSchema = z.object({
  autoApprove: z.boolean().optional(),
  blockedTools: z.array(z.string().trim().min(1).max(100)).max(200).optional(),
  blockedCommands: z.array(z.string().trim().min(1).max(200)).max(200).optional(),
})
