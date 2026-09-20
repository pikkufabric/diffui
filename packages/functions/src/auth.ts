import { betterAuth } from 'better-auth'
import { apiKey } from '@better-auth/api-key'
import { bearer, deviceAuthorization, organization } from 'better-auth/plugins'
import { ACTOR_SIGN_IN_OPT_IN_ENV, pikkuActor, pikkuBan, pikkuFabric } from '@pikku/better-auth'
import { pikkuBetterAuth } from '#pikku/auth'

/**
 * Better Auth configuration — email + password sign-in.
 *
 * `pikkuBetterAuth` has no side effects: the pikku CLI statically inspects this single
 * exported `auth` const and generates the catch-all `/api/auth/**` HTTP wiring,
 * the session-bridge middleware, and a `defineSecret` for `BETTER_AUTH_SECRET` (and
 * one per social provider, if you add any) — so the auth routes and secret
 * requirements flow through normal inspection into the deploy manifest.
 *
 * The factory runs once when singleton services are built, pulling the secret
 * (and the database) off the injected `services`; the resolved instance is then
 * available to every function as `services.auth`. Better Auth is given the app's
 * own kysely: the CamelCasePlugin maps Better Auth's camelCase field names onto
 * the snake_case columns created in db/sqlite/0001-better-auth.sql, keeping the whole DB
 * on one naming convention. To offer Google / GitHub / ... add a `socialProviders`
 * entry (and a button on the login page) — the CLI will wire its secret too.
 */
// The factory receives the FULL singleton services (emailService, logger, …) —
// destructure whatever you need, e.g. `{ kysely, secrets, emailService }` to wire
// sendResetPassword/verification emails. It runs lazily after all services exist,
// so never re-construct a service here or reach for a dynamic import.
export const auth = pikkuBetterAuth(async ({ kysely, secrets, variables, emailService }) => {
  // `.reveal()` at the sink, not earlier: getSecret hands back a nominal
  // SecretValue that no concretely-typed parameter accepts, so every disclosure
  // is one greppable call. Better Auth wants the raw string, and this is where
  // it stops being a secret in the type system.
  const BETTER_AUTH_SECRET = (await secrets.getSecret('BETTER_AUTH_SECRET')).reveal()
  // Optional: the secret alone never opens /api/auth/sign-in/actor. The plugin
  // gates on `pikku dev`, or on the opt-in below for a stage meant to run
  // scenarios, and warns when a secret is set against a shut gate.
  const SCENARIO_ACTOR_SECRET = await secrets
    .getSecret('SCENARIO_ACTOR_SECRET')
    .then((value) => value?.reveal())
    .catch(() => undefined)
  // Fabric operator admin: the RSA public key the control plane's token is
  // verified against. The Fabric deployer pushes FABRIC_AUTH_PUBLIC_KEY onto
  // every stage; locally it's simply absent, which disables /sign-in/fabric.
  // Asymmetric — the app verifies, it can never forge an operator login.
  const FABRIC_AUTH_PUBLIC_KEY = await variables.get('FABRIC_AUTH_PUBLIC_KEY')
  // This stage's own identity. Every stage verifies the same public key, so
  // without it an operator token is admin on all of them at once; a token
  // carrying `aud` is refused unless this matches. Fabric binds it on deploy.
  const FABRIC_STAGE_ID = await variables.get('FABRIC_STAGE_ID')
  // The scenario opt-in, read through `variables` rather than left to
  // process.env: Fabric pushes it as a binding on every non-production stage,
  // and a Worker has no populated environment for the plugin to find it in.
  const ALLOW_ACTOR_SIGN_IN = await variables.get(ACTOR_SIGN_IN_OPT_IN_ENV)

  return betterAuth({
    secret: BETTER_AUTH_SECRET,
    database: { db: kysely, type: 'sqlite' },
    emailAndPassword: {
      enabled: true,
      // Without this, `requestPasswordReset` succeeds on the client and silently
      // sends nothing — the "Forgot password?" flow looks wired and dead-ends.
      // Better Auth builds `url` from its baseURL + the client's redirectTo, so
      // the app only supplies the message. Errors are logged, never swallowed:
      // a reset the user never receives must be visible in the logs.
      sendResetPassword: async ({ user, url }) => {
        await emailService.send({
          to: user.email,
          template: {
            name: 'reset-password',
            data: { email: user.email, resetUrl: url },
          },
        })
      },
    },
    // Stateless session: CLI splits out betterAuthStatelessSession so non-auth
    // units verify the signed cookie instead of bundling better-auth. pikku #737.
    session: { cookieCache: { enabled: true } },
    advanced: { database: { generateId: 'uuid' } },
    // Scenario actors: synthetic users (user.actor = true, see
    // db/sqlite/0001-better-auth.sql) signed in by pikkuScenario via
    // POST /api/auth/sign-in/actor { email, secret }. Never signs in real users.
    //
    // ban(): the enforcement half of better-auth's admin() plugin — the
    // banned/banReason/banExpires columns (see db/sqlite/0001-better-auth.sql) and the
    // session hook that refuses a banned user a session. It makes no
    // authorization decision: who may ban is decided by the `admin:users:ban`
    // scope on the RPC. Listing, banning and "view as" are @pikku/addon-admin's
    // scoped RPCs (src/addons/admin.addon.ts), which is what the console's Users
    // tab calls — administering an app is ordinary application behaviour and
    // must not depend on better-auth's `role` column.
    //
    // fabric(): exposes /api/auth/sign-in/fabric — the Fabric control plane
    // mints a short-lived RS256 token and signs in as a synthetic `fabric: true`
    // operator (db/sqlite/0001-better-auth.sql) granted the umbrella `admin` scope, so
    // the console Users tab can list/impersonate real users without the operator
    // being one of them. Verifies against FABRIC_AUTH_PUBLIC_KEY; missing key
    // disables the endpoint.
    // organization(): tenancy. A diffui project belongs to an organisation and
    // never to a user, so that two teams can both track an app called `bb2`
    // without seeing each other — see
    // knowledge/decisions/one-app-orgs-for-tenancy.md.
    //
    // It brings its own owner/admin/member roles for invitations, and those are
    // deliberately NOT mirrored as pikku system roles: the app declares one
    // role (`engineer`), and a parallel set here would be a second answer to
    // who may do what. Which organisation a caller is acting in comes off the
    // session as `activeOrganizationId`, which is what every project function's
    // permission reads.
    //
    // deviceAuthorization() + bearer(): how the `diffui` CLI signs in from a
    // consuming repo. The CLI has no browser and no password to hold, so it
    // runs the RFC 8628 device flow — it asks for a code, the engineer approves
    // it in a browser they are already signed into, and the CLI polls until it
    // is handed a session token. `bearer()` is what then lets that token arrive
    // as `Authorization: Bearer <token>` instead of as a cookie.
    //
    // A machine in CI wants the OTHER path — a scoped API key on `x-api-key` —
    // and the two must never share a header. That path is not wired yet; see
    // knowledge/questions/how-should-ci-authenticate.md.
    plugins: [
      organization(),
      deviceAuthorization({ expiresIn: '5min', interval: '5s', schema: {} }),
      bearer(),
      // apiKey(): the credential the CLI actually calls functions with.
      //
      // The device flow above ends in a better-auth SESSION token, and a session
      // token only resolves on better-auth's own routes — the `bearer()` hook
      // does not run when pikku's session middleware calls `auth.api.getSession`
      // directly, so a bearer session never authenticates an RPC. A key does,
      // through the middleware's own api-key branch, which is the documented
      // machine path. `login` therefore trades its session for a key once and
      // stores the key.
      apiKey({
        enableMetadata: true,
        enableSessionForAPIKeys: true,
        // A CEILING, not a throttle.
        //
        // The plugin's default is TEN requests per day per key, which is not a
        // rate limit for this shape of client: `diffui push` costs two calls per
        // screenshot, so a four-hundred-shot push is eight hundred calls and the
        // default fails the SECOND screenshot with "Authentication required".
        // Ten is not obviously wrong until you know that.
        //
        // Ten thousand a day is roughly twelve full pushes — enough to re-run
        // after a fix, low enough to stop a runaway loop. The limit is per KEY,
        // so CI and a laptop each get their own budget and one cannot exhaust
        // the other.
        //
        // These numbers are DEFAULTS STAMPED AT KEY CREATION, not a policy read
        // at verify time: the plugin copies them into the row's
        // `rate_limit_max` / `rate_limit_time_window` columns when a key is
        // issued, and the verify path then reads only those columns. So
        // changing them here does nothing to keys that already exist, and a row
        // with either column NULL is exempt from the limit entirely.
        //
        // Note this is not a free check. On the limited path, verification
        // increments `request_count` and sets `last_request` — a database WRITE
        // on every authenticated call. Enabling it buys a cap at that price.
        // (`remaining` is a different feature, a lifetime quota, and this does
        // not touch it.)
        rateLimit: { enabled: true, maxRequests: 10000, timeWindow: 1000 * 60 * 60 * 24 },
      }),
      pikkuActor({
        secret: SCENARIO_ACTOR_SECRET,
        allowSignIn: ALLOW_ACTOR_SIGN_IN,
      }),
      pikkuBan(),
      pikkuFabric({
        publicKey: FABRIC_AUTH_PUBLIC_KEY,
        audience: FABRIC_STAGE_ID,
      }),
    ],
  })
})
