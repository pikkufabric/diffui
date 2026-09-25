import { defineVariable } from '@pikku/core/variable'
import { z } from 'zod'

export const DiagCookieMaxAgeSchema = z.string().default('86400')

defineVariable({
  name: 'diagCookieMaxAge',
  displayName: 'Diag Cookie Max Age',
  description: 'Bisect probe: an optional variable declared the way @pikku/cli 0.12.162 generates sessionCookieCacheMaxAge.',
  variableId: 'DIAG_COOKIE_MAX_AGE',
  schema: DiagCookieMaxAgeSchema,
  optional: true,
})
