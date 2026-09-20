/**
 * The people this app is for, and the people its scenarios run as.
 *
 * One `definePersonas` call for the whole project — codegen builds the
 * `PersonaId` union from it, materialises one scenario actor per person, and
 * seeds a user row each, so a second call site would be a second answer to
 * "who uses this app".
 *
 * Addresses are never written down: each is derived from the persona id and
 * `scenarios.emailDomain` in pikku.config.json, so `maya` signs in as
 * maya@actors.local. Writing one by hand is how a run signs in as somebody who
 * was never created.
 *
 * TWO ENGINEERS, DELIBERATELY. diffui scopes everything to an organisation, and
 * "you see yours, not theirs" cannot be tested with one person. `rafi` exists so
 * that the refusal in `01-a-project-and-its-routes` is a real assertion rather
 * than a claim — he belongs to a different organisation and must not be able to
 * reach maya's project.
 *
 * There is one role. Organisation membership carries tenancy and Better Auth's
 * organisation plugin brings its own owner/admin/member roles for invitations;
 * declaring a parallel set here would give two answers to who may do what. See
 * knowledge/decisions/one-app-orgs-for-tenancy.md.
 */
import { definePersonas } from '#pikku/scopes/pikku-personas.gen.js'
import { defineSystemRole } from '#pikku/scopes'

defineSystemRole({
  engineer: {
    displayName: 'Engineer',
    description:
      'Runs a rebuild — declares the screens it tracks, pushes screenshots, reads the report',
    scopes: [],
  },
})

definePersonas({
  maya: {
    name: 'Maya',
    jobTitle: 'Engineer',
    personality:
      'Rebuilding a legacy app screen by screen — opens the worst-diff list first, every time',
    roles: ['engineer'],
    account: {},
  },
  rafi: {
    name: 'Rafi',
    jobTitle: 'Engineer',
    personality:
      'Works in a different organisation — exists so that "you see yours, not theirs" is testable',
    roles: ['engineer'],
    account: {},
  },
})
