// No-leak scripted games over the handlers (spec BR-801, VC-831; plan P-12). Every body the human
// seat receives is checked against the server's current state with `assertNoLeak`.
import { describe, expect, it } from 'vitest';
import { createGameHandler, getGameHandler, submitMoveHandler } from '@/app/api/_lib/handlers';
import { CreateGameResponseSchema, PlayerUpdateResponseSchema } from '@/app/api/_lib/schemas';
import { buildDeck } from '@/src/domain/decks';
import type { PresetId } from '@/src/domain/rules';
import type { PlayerUpdate } from '@/src/domain/types';
import { GameStateManager } from '@/src/state/game-state-manager';
import { firstLegalMoveId } from '../unit/service/support/service-fixtures';
import {
  bearer,
  createGameVia,
  ctx,
  getReq,
  makeApi,
  postJson,
  readJson,
} from './support/api-fixtures';
import { assertNoLeak, type LeakCheckResult } from './support/leak-oracle';

/** How many bodies of each kind one game checked. */
interface Tally {
  bodies: number;
  inProgress: number;
  gameOver: number;
  noUpdate: number;
  stockTrump: number;
  fullDeal: number;
  conflicts: number;
  illegal: number;
}

/**
 * Plays `rulesPreset` with `aiCount` AIs to game over over the handlers and runs `assertNoLeak` on
 * the 201, on every move response, on a GET without and with `since=0` after every move, and on
 * one provoked 409 and one provoked 422 (after the first move). The seat token is allowed only in
 * the 201. Returns the tally and the hand plan.
 */
async function playAndCheck(
  rulesPreset: PresetId,
  aiCount: number,
): Promise<{ tally: Tally; handPlan: number[] }> {
  const api = makeApi();
  const tally: Tally = {
    bodies: 0,
    inProgress: 0,
    gameOver: 0,
    noUpdate: 0,
    stockTrump: 0,
    fullDeal: 0,
    conflicts: 0,
    illegal: 0,
  };

  const created = await createGameHandler(
    postJson('/api/games', { humanName: 'Ana', aiCount, rulesPreset }),
    api.deps,
  );
  expect(created.status).toBe(201);
  const createdBody = await readJson(created);
  const { gameId, seatToken, update: first } = CreateGameResponseSchema.parse(createdBody);
  const auth = bearer(seatToken);

  const check = async (body: unknown, allowToken = false): Promise<void> => {
    const result: LeakCheckResult = await assertNoLeak(body, {
      store: api.store,
      gameId,
      seat: 0,
      seatToken,
      allowToken,
    });
    tally.bodies++;
    if (result.kind === 'in-progress') tally.inProgress++;
    if (result.kind === 'game-over') tally.gameOver++;
    if (result.kind === 'none') tally.noUpdate++;
    if (result.stockTrump) tally.stockTrump++;
    if (result.fullDeal) tally.fullDeal++;
  };

  await check(createdBody, true);

  const move = (body: unknown): Promise<Response> =>
    submitMoveHandler(
      postJson(`/api/games/${gameId}/moves`, body, { headers: auth }),
      ctx(gameId),
      api.deps,
    );

  let update: PlayerUpdate = first;
  let n = 0;
  while (update.view.phase !== 'game-over') {
    const previous = update.version;
    n++;
    const res = await move({
      version: previous,
      moveId: firstLegalMoveId(update),
      clientRequestId: `leak-${n}`,
    });
    expect(res.status).toBe(200);
    const body = await readJson(res);
    update = PlayerUpdateResponseSchema.parse(body);
    await check(body);

    for (const path of [`/api/games/${gameId}`, `/api/games/${gameId}?since=0`]) {
      const got = await getGameHandler(getReq(path, auth), ctx(gameId), api.deps);
      expect(got.status).toBe(200);
      await check(await readJson(got));
    }

    if (n === 1) {
      const conflict = await move({
        version: previous,
        moveId: 'bid:0',
        clientRequestId: 'leak-conflict',
      });
      expect(conflict.status).toBe(409);
      await check(await readJson(conflict));
      tally.conflicts++;

      const illegal = await move({
        version: update.version,
        moveId: 'play:ZZ',
        clientRequestId: 'leak-illegal',
      });
      expect(illegal.status).toBe(422);
      await check(await readJson(illegal));
      tally.illegal++;
    }
  }
  return { tally, handPlan: update.view.handPlan };
}

/**
 * A whole game takes ≈ 4 s locally, close to Vitest's 5 s default: most of it is the service
 * re-reading every commit for each `?since=0` GET (D-017).
 */
const GAME_TIMEOUT_MS = 60_000;

describe('VC-831: no body leaks hands, stock, seed, hashes or the token', () => {
  it.each([
    { preset: 'argentina-fidepo' as const, aiCount: 3 },
    { preset: 'spain-ludoteka' as const, aiCount: 2 },
  ])(
    '$preset with $aiCount AIs, to game over',
    async ({ preset, aiCount }) => {
      const { tally, handPlan } = await playAndCheck(preset, aiCount);
      // The human makes one bid and plays `c` cards in a hand of `c`: one move each.
      const moves = handPlan.reduce((sum, c) => sum + 1 + c, 0);
      // 201 + (move, GET, GET ?since=0) per move + one 409 + one 422.
      expect(tally.bodies).toBe(1 + 3 * moves + 2);
      expect(tally.conflicts).toBe(1);
      expect(tally.illegal).toBe(1);
      expect(tally.noUpdate).toBe(1);
      // The last move, and the two GETs after it, see game over.
      expect(tally.gameOver).toBe(3);
      expect(tally.inProgress).toBe(tally.bodies - tally.noUpdate - tally.gameOver);
      expect(tally.stockTrump).toBeGreaterThan(0);
      expect(tally.stockTrump + tally.fullDeal).toBe(tally.inProgress);
      if (preset === 'argentina-fidepo') {
        // Hand 0 deals the whole French deck to 4 seats (4 × 13): its trump is the dealer's card.
        expect(handPlan[0]).toBe(13);
        expect(tally.fullDeal).toBeGreaterThan(0);
      }
    },
    GAME_TIMEOUT_MS,
  );
});

describe('P-12: the oracle catches each kind of leak', () => {
  /** A real GET body at the tip of a fresh game, the state behind it and the oracle context. */
  async function fixture() {
    const api = makeApi();
    // Spain's hand 0 deals one card each, so most of the deck is stock.
    const ids = await createGameVia(api, {
      humanName: 'Ana',
      aiCount: 2,
      rulesPreset: 'spain-ludoteka',
    });
    const res = await getGameHandler(
      getReq(`/api/games/${ids.gameId}`, bearer(ids.seatToken)),
      ctx(ids.gameId),
      api.deps,
    );
    const body = PlayerUpdateResponseSchema.parse(await readJson(res));
    const { state } = await new GameStateManager(api.store).loadLatest(ids.gameId);
    if (state.hand === null) throw new Error('expected a hand in progress');
    const hand = state.hand;
    const dealt = new Set(hand.hands.flat().map((c) => `${c.suit}|${c.rank}`));
    const stockCard = buildDeck(state.rules.deck, state.seats.length).find(
      (c) => !dealt.has(`${c.suit}|${c.rank}`) && c.suit !== hand.trumpCard.suit,
    );
    if (stockCard === undefined) throw new Error('expected a stock card');
    const leakCtx = {
      store: api.store,
      gameId: ids.gameId,
      seat: 0,
      seatToken: ids.seatToken,
      allowToken: false,
    };
    return { body, state, hand, stockCard, leakCtx, seed: state.seed };
  }

  it('accepts the untouched body', async () => {
    const { body, leakCtx } = await fixture();
    await expect(assertNoLeak(body, leakCtx)).resolves.toMatchObject({ kind: 'in-progress' });
  });

  const mutations: [string, (f: Awaited<ReturnType<typeof fixture>>) => unknown][] = [
    [
      "another seat's card in the view",
      (f) => ({
        ...f.body,
        view: {
          ...f.body.view,
          seats: f.body.view.seats.map((s, i) => (i === 1 ? { ...s, x: f.hand.hands[1][0] } : s)),
        },
      }),
    ],
    [
      'a stock card in the view',
      (f) => ({
        ...f.body,
        view: { ...f.body.view, scoreboard: { ...f.body.view.scoreboard, peek: f.stockCard } },
      }),
    ],
    [
      'yourHand differs from the state',
      (f) => ({ ...f.body, view: { ...f.body.view, yourHand: f.body.view.yourHand.slice(1) } }),
    ],
    ['a wrong trumpCard', (f) => ({ ...f.body, view: { ...f.body.view, trumpCard: f.stockCard } })],
    [
      'a card outside the two event positions',
      (f) => ({ ...f.body, events: [{ type: 'bid-made', seat: 1, tricks: 0, card: f.stockCard }] }),
    ],
    [
      'a legal move of another seat',
      (f) => ({
        ...f.body,
        legalMoves: [{ id: 'bid:0', move: { type: 'bid', seat: 1, tricks: 0 } }],
      }),
    ],
    [
      'a played card not in yourHand',
      (f) => ({
        ...f.body,
        legalMoves: [{ id: 'play:x', move: { type: 'play', seat: 0, card: f.stockCard } }],
      }),
    ],
    [
      'a seed key at depth',
      (f) => ({
        ...f.body,
        view: { ...f.body.view, seats: [{ ...f.body.view.seats[0], seed: 'x' }] },
      }),
    ],
    ['an aiDecisionCount key', (f) => ({ ...f.body, aiDecisionCount: 0 })],
    ['a seatTokenHashes key', () => ({ error: { code: 'x', message: 'y' }, seatTokenHashes: [] })],
    ['the seed string', (f) => ({ error: { code: 'x', message: f.seed } })],
    [
      'an array of card arrays',
      (f) => ({ error: { code: 'x', message: 'y' }, h: [[f.stockCard]] }),
    ],
    ['the seat token outside the 201', (f) => ({ ...f.body, token: f.leakCtx.seatToken })],
    ['an extra update key', (f) => ({ ...f.body, extra: 1 })],
  ];

  it.each(mutations)('rejects %s', async (_name, mutate) => {
    const f = await fixture();
    await expect(assertNoLeak(mutate(f), f.leakCtx)).rejects.toThrow();
  });
});
