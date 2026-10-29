import test from 'node:test';
import assert from 'node:assert/strict';
import { eligibleGroup, flattenChildren, planInsertion } from '../plugins/elevenlabs-transcription/js/menu.js';
import type { ElementLike } from '../plugins/elevenlabs-transcription/js/tree.js';
// Arbres SYNTHÉTIQUES : aucune observation du client Discord réel. Ils prouvent la politique, pas la structure appareil.
const el = (type: unknown, props: Record<string, unknown> = {}): ElementLike => ({ type, props });
const Sheet = 'Sheet'; const Group = 'Group'; const Row = () => null; const AliasRow = 'TableRow'; const Icon = 'Icon';
const identity = { sheet: Sheet, groups: new Set<unknown>([Group]), rows: new Set<unknown>([Row, AliasRow]) };
const row = (label: string, extra: Record<string, unknown> = {}) => el(Row, { label, icon: el(Icon), onPress() {}, ...extra });
const group = (children: unknown, extra: Record<string, unknown> = {}) => el(Group, { children, ...extra });
const sheet = (children: unknown) => el(Sheet, { children });

test('insertion planned only for the unique eligible native group; refusals are explicit', () => {
  const primary = group([row('a'), row('b')]);
  const plan = planInsertion(sheet([primary, group([row('x', { variant: 'danger' })])]), identity);
  assert.deepEqual(plan, { ok: true, group: primary, groups: 2 });
  assert.deepEqual(planInsertion(sheet([]), identity), { ok: false, reason: 'no-group', groups: 0 });
  assert.deepEqual(planInsertion(sheet([group([row('x', { variant: 'danger' })])]), identity), { ok: false, reason: 'no-eligible-group', groups: 1 });
  assert.deepEqual(planInsertion(sheet([group([row('a')]), group([row('b')])]), identity), { ok: false, reason: 'ambiguous', groups: 2 });
  assert.deepEqual(planInsertion(el('View', { children: [group([row('a')])] }), identity), { ok: false, reason: 'sheet', groups: 0 });
  assert.deepEqual(planInsertion(el('View', { children: [sheet([group([row('a')])]), sheet([group([row('b')])])] }), identity), { ok: false, reason: 'sheet', groups: 0 });
  assert.deepEqual(planInsertion(null, identity), { ok: false, reason: 'sheet', groups: 0 });
});
test('eligibility: native rows only, no danger, an action, icon support via rows or hasIcons', () => {
  const rows = identity.rows;
  assert.equal(eligibleGroup(group([row('a'), el(AliasRow, { label: 'alias', icon: el(Icon), onPress() {} })]), rows), true);
  assert.equal(eligibleGroup(group([el('Fragment', { children: [row('a')] })]), rows), false);
  assert.equal(eligibleGroup(group([row('a'), el('Custom', { onPress() {}, icon: el(Icon) })]), rows), false);
  assert.equal(eligibleGroup(group([row('a', { icon: undefined })]), rows), false);
  assert.equal(eligibleGroup(group([row('a', { icon: undefined })], { hasIcons: true }), rows), true);
  assert.equal(eligibleGroup(group([el(Row, { label: 'static', icon: el(Icon) })]), rows), false);
  assert.equal(eligibleGroup(group([row('a'), row('b', { variant: 'danger' })]), rows), false);
  assert.equal(eligibleGroup(group([]), rows), false);
  assert.equal(eligibleGroup(group([[row('a'), null, false], undefined, [[row('b')]]]), rows), true);
});
test('visibility: traversal through host containers only, never into groups or composite renders', () => {
  const inner = group([row('a')]);
  const wrapped = sheet([el('View', { children: el('ScrollView', { children: [null, [inner]] }) })]);
  assert.deepEqual(planInsertion(wrapped, identity), { ok: true, group: inner, groups: 1 });
  // A group nested inside another group is not a second candidate.
  const outer = group([row('a'), group([row('b')])]);
  assert.deepEqual(planInsertion(sheet([outer]), identity), { ok: false, reason: 'no-eligible-group', groups: 1 });
  // Content owned by a composite component is invisible before render: refuse rather than guess.
  const Composite = () => group([row('hidden')]);
  assert.deepEqual(planInsertion(sheet([el(Composite, {})]), identity), { ok: false, reason: 'no-group', groups: 0 });
});
test('bounded traversal: excessive depth or width refuses; cycles terminate without refusing the rest', () => {
  let deep: unknown = group([row('a')]);
  for (let i = 0; i < 20; i++) deep = el('View', { children: deep });
  assert.deepEqual(planInsertion(sheet(deep), identity), { ok: false, reason: 'budget', groups: 0 });
  const wide = sheet(Array.from({ length: 400 }, () => el('View', {})));
  assert.deepEqual(planInsertion(wide, identity), { ok: false, reason: 'budget', groups: 0 });
  const cyclic = el('View', {}); cyclic.props.children = cyclic;
  const target = group([row('a')]);
  assert.deepEqual(planInsertion(sheet([cyclic, target]), identity), { ok: true, group: target, groups: 1 });
});
test('flattenChildren mirrors React child flattening', () => {
  assert.deepEqual(flattenChildren([null, ['a', [false, 'b']], undefined, true, 0]), ['a', 'b', 0]);
  assert.deepEqual(flattenChildren('single'), ['single']);
  assert.deepEqual(flattenChildren(undefined), []);
});
