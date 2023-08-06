import { z } from './deps.ts'
import { Grob } from './grob.ts'

export const URLString = z.string()
export const Filepath = z.string()
export const RegexString = z.string()
export const Headers = z.record(z.string(), z.string())

export const RateLimitQueueConfig = z.object({
  rate_per_second: z.number().optional(),
  concurrent_limit: z.number().optional(),
})

export const GrobConfig = z.object({
  download_folder: Filepath.optional(),
  headers: Headers.optional(),
  throttle: RateLimitQueueConfig.optional()
})
export const GrobOptions = z.object({
  cache: z.boolean().optional(),
  expires_on: z.date().optional(),
})

export const GrobName = z.string()
export const GrobberRegistration = z.union([URLString, Filepath])

export const GrobberDefinition = z.object({
  name: GrobName,
  // match: RegexString,
  folder: Filepath.optional(),
  permissions: RegexString.array().optional(),
  throttle: RateLimitQueueConfig.optional(),
  depends_on: GrobberRegistration.array().optional(),
  headers: Headers.optional(),
  main: GrobberRegistration,
})
