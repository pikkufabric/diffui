import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as babel from '@babel/core'
import injectTestIds from './inject-testids'

const stamp = (source: string): string => {
  const result = babel.transformSync(source, {
    filename: 'src/routes/app/today.tsx',
    babelrc: false,
    configFile: false,
    parserOpts: { plugins: ['jsx', 'typescript'] },
    plugins: [injectTestIds],
  })
  return result?.code ?? ''
}

/** What the stamper put on the page, so a test reads as the addresses a scenario would use. */
const ids = (source: string): string[] =>
  [...stamp(source).matchAll(/data-testid="([^"]+)"/g)].map((match) => match[1]!)

test('a button is addressed by the message key it renders', () => {
  assert.deepEqual(ids('<Button>{m.entry__save()}</Button>'), ['entry__save'])
})

test('a field is addressed by the key in its label', () => {
  assert.deepEqual(ids('<TextInput label={m.entry__body_label()} />'), ['entry__body_label'])
})

// An icon-only button has no text to read, and aria-label is where its meaning already
// lives — the attribute it needs for a screen reader regardless.
test('an icon-only button is addressed by its aria-label', () => {
  assert.deepEqual(ids('<ActionIcon aria-label={m.entry__delete()}><Trash /></ActionIcon>'), [
    'entry__delete',
  ])
})

// The label is as often a conditional as a bare call; the first key wins, because an id
// that changed with state could not be addressed at all.
test('a conditional label resolves to one stable key', () => {
  assert.deepEqual(ids('<Button>{busy ? m.entry__saving() : m.entry__save()}</Button>'), [
    'entry__saving',
  ])
})

test('a compound control is stamped too', () => {
  assert.deepEqual(ids('<Menu.Item>{m.entry__archive()}</Menu.Item>'), ['entry__archive'])
})

test('a literal name carries a control whose label is dynamic', () => {
  assert.deepEqual(ids('<TextInput name="email" label={label} />'), ['email'])
})

// Deliberate: a positional fallback would shift the moment a control is added above it.
test('a control with no key and no name is left unaddressed', () => {
  assert.deepEqual(ids('<Button>{label}</Button>'), [])
})

test('a non-interactive element is not stamped', () => {
  assert.deepEqual(ids('<Text>{m.entry__title()}</Text>'), [])
})

// The hand-written id is how a list row carries the id of the record it shows.
test('an explicit testid always wins', () => {
  assert.deepEqual(ids('<Button data-testid="row-1">{m.entry__save()}</Button>'), ['row-1'])
})

test('a spread is left alone rather than merged into', () => {
  assert.deepEqual(ids('<Button {...props}>{m.entry__save()}</Button>'), [])
})

// The container half: keys are reused on purpose, so `within` needs something to name.
test("a component's root element is addressed by the component name", () => {
  assert.deepEqual(
    ids('function EntryForm() { return <Stack><Button>{m.common__save()}</Button></Stack> }'),
    ['entry-form', 'common__save'],
  )
})

test('an arrow component is a component too', () => {
  assert.deepEqual(ids('const EntryForm = () => { return <Stack /> }'), ['entry-form'])
})

// Both branches, so a component is addressable while it is still loading.
test('every returned root is stamped, not just the first', () => {
  assert.deepEqual(
    ids('function EntryForm() { if (busy) { return <Loader /> } return <Stack /> }'),
    ['entry-form', 'entry-form'],
  )
})

// A map callback's return belongs to the callback, not to the component around it.
test('a return inside a nested function is not the component root', () => {
  assert.deepEqual(
    ids('function EntryList() { return <Stack>{rows.map((r) => { return <Card /> })}</Stack> }'),
    ['entry-list'],
  )
})

test('a plain helper function is not a component', () => {
  assert.deepEqual(ids('function buildRow() { return <Stack /> }'), [])
})

// Babel reaches the component before its JSX, so without an explicit guard the container
// rule stamps the root first and the control rule then sees it as already claimed. Found on
// the template's own ThemeSelector, whose root IS the Select.
test('a component whose root is a control keeps the control key, not the component name', () => {
  assert.deepEqual(
    ids('function ThemeSelector() { return <Select aria-label={m.preferences__theme()} /> }'),
    ['preferences__theme'],
  )
})
