import { wireHTTP } from '#pikku/http'
import { recordAnalyticsEvents } from './record-analytics-events.function.js'
import { analyticsOriginMiddleware } from './analytics-origin.middleware.js'

/**
 * The analytics beacon endpoint. Unauthed on purpose — anonymous visitors are
 * most of what this measures — and guarded by `analyticsOriginMiddleware`,
 * which rejects anything that is not a browser on this app's own origin (403).
 *
 * That is an origin lock, not a flood control: `Origin` is set by the browser
 * and trusted by nobody else, so it stops another site's page beaconing in here
 * but not a determined client. Rate limiting is deliberately absent — it is a
 * platform concern rather than one route's, and is not built yet. Until it is,
 * treat volume through here as unbounded.
 *
 * It lives in `scaffold/fabric/analytics/` so the build-complete journey-coverage gate skips
 * it: that gate asks whether a real user journey exercises each mutation, and this one
 * ships with the template rather than answering anything a user asked for. Sitting in
 * `functions/` and `wires/http/` it read as an ordinary uncovered mutation and made
 * builds author a scenario for a beacon they had not written.
 */
wireHTTP({
  method: 'post',
  route: '/analytics',
  func: recordAnalyticsEvents,
  auth: false,
  middleware: [analyticsOriginMiddleware],
})
