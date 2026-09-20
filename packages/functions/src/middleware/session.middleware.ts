/**
 * Who is calling — the human path and the machine path, on one resolver.
 *
 * This replaces the `betterAuthSession()` the generator would otherwise emit.
 * It is registered by hand for exactly one reason: to turn on the **api-key
 * branch**, which is how the `diffui` CLI authenticates.
 *
 * Why a key and not the session token the CLI logs in with: better-auth's
 * `bearer()` plugin converts `Authorization: Bearer` into a session cookie in a
 * hook on better-auth's OWN routes. Pikku's session middleware does not go
 * through those routes — it calls `auth.api.getSession({ headers })` directly —
 * so the hook never runs and a bearer session never authenticates an RPC.
 * Verified, not assumed: a correctly signed session token presented as a bearer
 * resolves at `/api/auth/get-session` and is refused at `/rpc/listProjects`.
 *
 * So the two paths stay on two headers, as they are meant to:
 *   humans   `Authorization: Bearer` / cookie  → getSession
 *   machines `x-api-key`                        → verifyApiKey
 */
import { betterAuthSession } from '@pikku/better-auth'
import { addGlobalMiddleware } from '@pikku/core/middleware'

addGlobalMiddleware([
  betterAuthSession({
    apiKey: {
      /*
       * A diffui CLI key acts with its owner's full rights, so no `scopes` are
       * set here — an explicit set would be authoritative and would silently
       * narrow what the engineer who created the key can do.
       *
       * `userId` comes from the verified key rather than from its metadata:
       * metadata is baked in at mint time and would keep working after the key
       * was reassigned, which is the sort of thing nobody notices until it
       * matters.
       */
      mapKey: (key) => {
        /* `referenceId` is where this version of the api-key plugin keeps the
           owning user — the table's column is `reference_id`, and `userId` is
           undefined on the verified key. Reading only `userId` produced a key
           that verified successfully and then mapped to nothing, which surfaces
           as "Authentication required" with no error anywhere. */
        const userId = key?.userId ?? key?.referenceId
        if (!userId) return null
        return { userId }
      },
    },
  }),
])
