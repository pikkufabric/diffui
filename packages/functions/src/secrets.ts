/**
 * Secrets this project reads that no scaffold declares for it.
 *
 * `auth.ts` reads `SCENARIO_ACTOR_SECRET`, so pikku requires a declaration for it
 * (PKU951) — without one, codegen fails and the dev server will not boot.
 *
 * It is `optional` because absence is a supported state: unset simply disables
 * `/api/auth/sign-in/actor` and the actor plugin refuses every sign-in. A deploy
 * that does not set it is a deploy with scenario sign-in off, not a broken one, so
 * the deploy gate must not demand a value.
 */
import { defineSecret } from '@pikku/core/secret'
import { z } from 'zod'

export const ScenarioActorSecretSchema = z.string()

defineSecret({
  name: 'scenarioActorSecret',
  displayName: 'Scenario Actor Secret',
  description: 'Signing key for /api/auth/sign-in/actor. Unset disables actor sign-in.',
  secretId: 'SCENARIO_ACTOR_SECRET',
  schema: ScenarioActorSecretSchema,
  optional: true,
})

/**
 * `BETTER_AUTH_SECRET`, declared by hand.
 *
 * `auth.ts` says the CLI generates this declaration from the `pikkuBetterAuth`
 * call, and on this template it does not — a clean scaffold reports PKU951 for
 * it on the very first `pikku all`. Declaring it here is what the error asks
 * for, and it is not cosmetic: the deploy manifest is how whoever provisions a
 * stage learns this has to be set, and an undeclared secret is one nobody is
 * told about until sign-in fails.
 *
 * NOT optional, unlike the actor secret above. Absence is not a supported
 * state — with no signing key there are no sessions, so a deploy without it is
 * broken rather than merely reduced, and the gate should say so before it
 * ships rather than after.
 */
export const BetterAuthSecretSchema = z.string().min(1)

defineSecret({
  name: 'betterAuthSecret',
  displayName: 'Better Auth Secret',
  description: 'Signing key for every session this app issues. Without it nobody can sign in.',
  secretId: 'BETTER_AUTH_SECRET',
  schema: BetterAuthSecretSchema,
})
