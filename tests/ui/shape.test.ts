import { describe, expect, it } from 'vitest';
import { isCreateBody, isPlayerUpdate, isPresetsBody } from '@/app/_client/shape';

const update = () => ({
  version: 3,
  events: [],
  view: { seats: [], handPlan: [], yourHand: [], scoreboard: {} },
  legalMoves: [],
});

type Obj = Record<string, unknown>;
const without = (o: Obj, key: string): Obj => {
  const copy = { ...o };
  delete copy[key];
  return copy;
};
const withView = (patch: Obj | null): Obj => {
  const u = update();
  return { ...u, view: patch === null ? 'x' : { ...u.view, ...patch } };
};

describe('isPlayerUpdate (FR-936)', () => {
  it('accepts a well-formed update', () => {
    expect(isPlayerUpdate(update())).toBe(true);
  });

  it('rejects non-objects', () => {
    for (const v of [null, undefined, 'x', 7, [], true]) expect(isPlayerUpdate(v)).toBe(false);
  });

  it.each([
    ['version missing', without(update(), 'version')],
    ['version a string', { ...update(), version: '9' }],
    ['events missing', without(update(), 'events')],
    ['events an object', { ...update(), events: {} }],
    ['view missing', without(update(), 'view')],
    ['view not an object', withView(null)],
    ['view.seats not an array', withView({ seats: {} })],
    ['view.handPlan missing', withView({ handPlan: undefined })],
    ['view.yourHand not an array', withView({ yourHand: 'x' })],
    ['view.scoreboard not an object', withView({ scoreboard: [] })],
    ['view.scoreboard null', withView({ scoreboard: null })],
    ['legalMoves missing', without(update(), 'legalMoves')],
    ['legalMoves not an array', { ...update(), legalMoves: 1 }],
  ])('rejects: %s', (_name, value) => {
    expect(isPlayerUpdate(value)).toBe(false);
  });

  it('trusts deeper fields', () => {
    expect(isPlayerUpdate({ ...update(), events: [{ nonsense: true }] })).toBe(true);
  });
});

describe('isCreateBody (FR-936)', () => {
  const body = () => ({ gameId: 'g', seat: 0, seatToken: 't', update: update() });

  it('accepts a well-formed body', () => {
    expect(isCreateBody(body())).toBe(true);
  });

  it.each([
    ['not an object', null],
    ['gameId missing', without(body(), 'gameId')],
    ['gameId a number', { ...body(), gameId: 1 }],
    ['seatToken missing', without(body(), 'seatToken')],
    ['seatToken a number', { ...body(), seatToken: 5 }],
    ['update missing', without(body(), 'update')],
    ['update malformed', { ...body(), update: {} }],
  ])('rejects: %s', (_name, value) => {
    expect(isCreateBody(value)).toBe(false);
  });
});

describe('isPresetsBody (FR-936, P-8)', () => {
  const body = () => ({
    defaultPresetId: 'a',
    presets: [
      { id: 'a', deck: 'spanish', name: 'A' },
      { id: 'b', deck: 'french' },
    ],
  });

  it('accepts a well-formed body', () => {
    expect(isPresetsBody(body())).toBe(true);
  });

  it.each([
    ['not an object', 'x'],
    ['defaultPresetId missing', without(body(), 'defaultPresetId')],
    ['defaultPresetId a number', { ...body(), defaultPresetId: 1 }],
    ['presets missing', without(body(), 'presets')],
    ['presets not an array', { ...body(), presets: {} }],
    ['entry not an object', { ...body(), presets: ['a'] }],
    ['entry id missing', { ...body(), presets: [{ deck: 'spanish' }] }],
    ['entry id a number', { ...body(), presets: [{ id: 1, deck: 'spanish' }] }],
    ['entry deck missing', { defaultPresetId: 'a', presets: [{ id: 'a' }] }],
    ['entry deck a number', { defaultPresetId: 'a', presets: [{ id: 'a', deck: 1 }] }],
    ['no entry matches defaultPresetId', { ...body(), defaultPresetId: 'zzz' }],
    ['empty presets', { ...body(), presets: [] }],
  ])('rejects: %s', (_name, value) => {
    expect(isPresetsBody(value)).toBe(false);
  });
});
