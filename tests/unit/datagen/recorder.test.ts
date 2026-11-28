// Recorder tests (spec 12 VC-1207..1216, BR-1201, BR-1208).
import { describe, expect, it } from 'vitest';
import { cardId } from '@/src/domain/cards';
import { buildDeck } from '@/src/domain/decks';
import { getPreset } from '@/src/domain/presets';
import type { GameState, PlayerView, Rng, SeatInfo } from '@/src/domain/types';
import { aiRng, applyMove, createGame, currentActor, legalMoves } from '@/src/engine/engine';
import { createAiPlayer } from '@/src/players/ai-player';
import type { AIStrategy } from '@/src/players/player';
import { getStrategy } from '@/src/players/registry';
import { runAiLoop } from '@/src/service/ai-loop';
import { buildPlayerView } from '@/src/service/player-view';
import { createRecorder } from '../../../scripts/datagen/recorder';
import { PendingDecisionRowSchema } from '../../../scripts/datagen/schema';

function seatsOf(n: number): SeatInfo[] {
  return Array.from({ length: n }, (_, i) => ({
    seat: i,
    playerId: `ai-${i}`,
    name: `AI ${i}`,
    kind: 'ai' as const,
    strategy: 'random',
  }));
}

function newGame(seed: string, preset = 'argentina-fidepo', n = 3) {
  return createGame({ gameId: seed, rules: getPreset(preset), seats: seatsOf(n), seed });
}

function playRecorded(seed: string, preset = 'argentina-fidepo', n = 3) {
  const start = newGame(seed, preset, n);
  const recorder = createRecorder(start.state);
  const players = start.state.seats.map((s) =>
    createAiPlayer(s.seat, s.name, recorder.wrapStrategy(s.seat, getStrategy(s.strategy))),
  );
  const result = runAiLoop(start.state, players, { onTransition: recorder.onTransition });
  return { start, result, rows: recorder.rows() };
}

function playPlain(seed: string, preset = 'argentina-fidepo', n = 3) {
  const start = newGame(seed, preset, n);
  const players = start.state.seats.map((s) =>
    createAiPlayer(s.seat, s.name, getStrategy(s.strategy)),
  );
  return runAiLoop(start.state, players);
}

const SEEDS = ['rec-a', 'rec-b', 'rec-c', 'rec-d', 'rec-e'];

describe('recorder rows', () => {
  it('VC-1207: steps run 0..m-1 and m equals the unrecorded moves', () => {
    for (const seed of SEEDS) {
      const { result, rows } = playRecorded(seed);
      expect(rows.map((r) => r.step)).toEqual(Array.from({ length: rows.length }, (_, i) => i));
      expect(rows.length).toBe(playPlain(seed).moves);
      expect(rows.length).toBe(result.moves);
    }
  }, 120_000);

  it('every row parses against the pending schema; VC-1214 key names', () => {
    const { rows } = playRecorded('rec-a');
    for (const row of rows) {
      expect(PendingDecisionRowSchema.parse(row)).toEqual(row);
      expect(Object.keys(row).filter((k) => k.startsWith('hidden_'))).toEqual([
        'hidden_hands',
        'hidden_stock_left',
      ]);
    }
    const keys = Object.keys(PendingDecisionRowSchema.shape);
    expect(keys.filter((k) => k.startsWith('hidden_'))).toEqual([
      'hidden_hands',
      'hidden_stock_left',
    ]);
  }, 120_000);

  it('VC-1208: bid and play row shapes', () => {
    const { rows } = playRecorded('rec-b');
    let bids = 0;
    let plays = 0;
    for (const row of rows) {
      if (row.decision_type === 'bid') {
        bids += 1;
        expect(row.current_trick).toEqual([]);
        expect(row.cards_played_this_hand).toEqual([]);
        expect(row.trick_number).toBe(0);
        expect(row.chosen_move_id.startsWith('bid:')).toBe(true);
      } else {
        plays += 1;
        expect(row.chosen_move_id.startsWith('play:')).toBe(true);
        expect(row.your_hand).toContain(row.chosen_move_id.slice('play:'.length));
      }
    }
    expect(bids).toBeGreaterThan(0);
    expect(plays).toBeGreaterThan(0);
  }, 120_000);

  it('VC-1209, BR-1208: legal ids equal legalMoves(prev) and the chosen id is accepted', () => {
    for (const seed of SEEDS) {
      const { start, rows } = playRecorded(seed);
      let state: GameState = start.state;
      for (const row of rows) {
        const ids = legalMoves(state, row.seat).map((m) => m.id);
        expect(row.legal_move_ids).toEqual(ids);
        expect(row.legal_move_ids[row.chosen_index]).toBe(row.chosen_move_id);
        state = applyMove(state, row.seat, row.chosen_move_id).state;
      }
      expect(state.phase).toBe('game-over');
    }
  }, 120_000);

  it('VC-1210: strategy name, policy_probs null, explore false', () => {
    for (const row of playRecorded('rec-c').rows) {
      expect(row.strategy).toBe('random');
      expect(row.policy_probs).toBeNull();
      expect(row.explore).toBe(false);
    }
  }, 120_000);

  it('trick_number and current_trick follow the public events', () => {
    const { rows } = playRecorded('rec-d');
    let lastHand = -1;
    let seenInHand: string[] = [];
    let tricks = 0;
    for (const row of rows) {
      if (row.hand_index !== lastHand) {
        lastHand = row.hand_index;
        seenInHand = [];
        tricks = 0;
      }
      expect(row.cards_played_this_hand).toEqual(seenInHand);
      expect(row.trick_number).toBe(tricks);
      expect(row.current_trick.length).toBe(
        row.decision_type === 'bid' ? 0 : seenInHand.length - tricks * row.bids_so_far.length,
      );
      if (row.decision_type === 'play') {
        seenInHand.push(row.chosen_move_id.slice('play:'.length));
        if (seenInHand.length % row.bids_so_far.length === 0) tricks += 1;
      }
    }
  }, 120_000);
});

describe('hidden columns', () => {
  // Configurations: both trump cases. 4 players on french-52 and spanish-40 deal the whole deck in
  // the largest hand; 3 and 5 players leave a stock.
  const CONFIGS: [string, number][] = [
    ['argentina-fidepo', 3],
    ['argentina-fidepo', 4],
    ['argentina-fidepo', 5],
    ['spain-ludoteka', 4],
    ['spain-ludoteka', 5],
  ];

  it('VC-1211 / VC-1212: union is the full deck; stock lengths per trump case', () => {
    let sawInDealer = false;
    let sawStock = false;
    for (const [preset, n] of CONFIGS) {
      const rules = getPreset(preset);
      const deck = buildDeck(rules.deck, n).map(cardId);
      const { rows } = playRecorded(`hid-${preset}-${n}`, preset, n);
      for (const row of rows) {
        expect(row.hidden_hands.length).toBe(n);
        expect(new Set(row.hidden_hands[row.seat])).toEqual(new Set(row.your_hand));
        const all = [
          ...row.hidden_hands.flat(),
          ...row.cards_played_this_hand,
          ...row.hidden_stock_left,
        ];
        if (!row.trump_in_dealer_hand) all.push(row.trump_card as string);
        expect(new Set(all).size).toBe(all.length);
        expect([...all].sort()).toEqual([...deck].sort());
        // Stock is in deck order.
        const positions = row.hidden_stock_left.map((id) => deck.indexOf(id));
        expect([...positions].sort((a, b) => a - b)).toEqual(positions);
        expect(row.hidden_stock_left).not.toContain(row.trump_card);
        const expected = deck.length - n * row.cards_dealt - (row.trump_in_dealer_hand ? 0 : 1);
        expect(row.hidden_stock_left.length).toBe(expected);
        if (row.trump_in_dealer_hand) sawInDealer = true;
        else sawStock = true;
      }
    }
    expect(sawInDealer).toBe(true);
    expect(sawStock).toBe(true);
  }, 120_000);
});

describe('observer effect', () => {
  it('VC-1215: 50 seeds end in the same state and events as unwrapped play', () => {
    for (let i = 0; i < 50; i++) {
      const seed = `obs-${i}`;
      const recorded = playRecorded(seed).result;
      const plain = playPlain(seed);
      expect(recorded.state).toEqual(plain.state);
      expect(recorded.state.aiDecisionCount).toBe(plain.state.aiDecisionCount);
      expect(recorded.events).toEqual(plain.events);
    }
  }, 120_000);

  it('VC-1216: the wrapper passes the same arguments and draws nothing extra', () => {
    const state = newGame('spy-1').state;
    const view = firstView(state);
    const moves = legalMoves(state, view.you as number);
    const seat = view.you as number;
    const calls: unknown[][] = [];
    const spy: AIStrategy = {
      name: 'spy',
      choose: (v, m, r) => {
        calls.push([v, m, r]);
        return m[r.int(0, m.length - 1)];
      },
    };
    const run = (strategy: AIStrategy) => {
      let draws = 0;
      const inner = aiRng(state, seat);
      const rng: Rng = {
        int: (a, b) => (draws++, inner.int(a, b)),
        shuffle: (items) => (draws++, inner.shuffle(items)),
      };
      calls.length = 0;
      const chosen = strategy.choose(view, moves, rng);
      return { draws, chosen, rng };
    };
    const alone = run(spy);
    const wrapped = run(createRecorder(state).wrapStrategy(seat, spy));
    expect(calls.length).toBe(1);
    expect(calls[0][0]).toBe(view);
    expect(calls[0][1]).toBe(moves);
    expect(calls[0][2]).toBe(wrapped.rng);
    expect(wrapped.draws).toBe(alone.draws);
    expect(wrapped.chosen).toBe(moves.find((m) => m.id === wrapped.chosen.id));
    expect(wrapped.chosen.id).toBe(alone.chosen.id);
  }, 120_000);

  it('one inner call per decision in a whole game', () => {
    const start = newGame('spy-2');
    let calls = 0;
    const counting: AIStrategy = {
      name: 'random',
      choose: (v, m, r) => (calls++, getStrategy('random').choose(v, m, r)),
    };
    const recorder = createRecorder(start.state);
    const players = start.state.seats.map((s) =>
      createAiPlayer(s.seat, s.name, recorder.wrapStrategy(s.seat, counting)),
    );
    const result = runAiLoop(start.state, players, { onTransition: recorder.onTransition });
    expect(calls).toBe(result.moves);
    expect(recorder.rows().length).toBe(result.moves);
  }, 120_000);
});

function firstView(state: GameState): PlayerView {
  const seat = currentActor(state) as number;
  return buildPlayerView(state, seat);
}
