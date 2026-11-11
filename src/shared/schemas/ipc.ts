import { z } from 'zod'

export const copyTextInputSchema = z.string().min(1).max(8192)
export const openPathInputSchema = z.string().min(1).max(1024)
