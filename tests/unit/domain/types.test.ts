// Domain exports and type shapes (spec 01 FR-118, FR-119; VC-117).
//
// Every type and value in the spec's Module exports table is imported from its listed module and
// referenced below. The 13 FR-118 types are compared with `toEqualTypeOf` against shapes copied by
// hand from the spec's Data & Interfaces listings (the `Exp*` types), so a schema change that
// alters an inferred type fails `pnpm typecheck` here.
import { describe, expectTypeOf, test } from 'vitest';
import {
  CardSchema,
  DeckDefinitionSchema,
  BoundSchema,
  SegmentSchema,
  HandSequenceSpecSchema,
  ScoringSpecSchema,
  RuleSetSchema,
  SeatInfoSchema,
  TrickPlaySchema,
  HandStateSchema,
  HandResultSchema,
  GameStateSchema,
  GameEventSchema,
} from '@/src/domain/schemas';
import {
  InvalidCardError,
  cardId,
  parseCard,
  compareRanks,
  type Suit,
  type Rank,
  type Card,
} from '@/src/domain/cards';
import { FRENCH_52, SPANISH_40, buildDeck, type DeckDefinition } from '@/src/domain/decks';
import type {
  Bound,
  Segment,
  HandSequenceSpec,
  ScoringSpec,
  PresetId,
  RuleSet,
} from '@/src/domain/rules';
import { PRESET_IDS, DEFAULT_PRESET_ID, UnknownPresetError, getPreset } from '@/src/domain/presets';
import type {
  Phase,
  SeatInfo,
  TrickPlay,
  HandState,
  HandResult,
  GameState,
  Move,
  LegalMove,
  GameEvent,
  Transition,
  Rng,
  HandScore,
  ScoreBoard,
  TableView,
  PlayerView,
  PlayerUpdate,
  DecisionContext,
  Decision,
} from '@/src/domain/types';

// ---- Expected shapes, copied by hand from the spec listings ------------------------------------

type ExpCard = { suit: string; rank: string };

type ExpDeckDefinition = {
  id: 'french-52' | 'spanish-40';
  suits: string[];
  ranksHighToLow: string[];
  removeRanksForPlayers: Record<string, string[]>;
};

type ExpBound = number | 'max' | { min: [number, 'max'] } | { offset: ['max', number] };

type ExpSegment =
  | { kind: 'range'; from: ExpBound; to: ExpBound }
  | { kind: 'repeat'; cards: ExpBound; times: number | 'players' };

type ExpHandSequenceSpec = ExpSegment[];

type ExpScoringSpec =
  | { kind: 'bonus-plus-tricks'; bonus: 10; perTrick: 1; missedPerTrick: 1 }
  | { kind: 'bonus-plus-bid'; bonus: 10 }
  | { kind: 'spanish'; bonus: 10; perTrick: 5; missPenaltyPerTrick: 5 };

type ExpPresetId = 'argentina-fidepo' | 'spain-ludoteka' | 'gamerules' | 'mexico-bazas';

type ExpRuleSet = {
  id: ExpPresetId;
  deck: ExpDeckDefinition;
  players: { min: number; max: number };
  handSequence: ExpHandSequenceSpec;
  trump: { source: 'next-stock-card-or-dealer-last' };
  bidding: { dealerRestriction: boolean; dealerRestrictionExemptCardCounts: number[] };
  play: {
    mustFollowSuit: true;
    mustTrumpWhenVoid: true;
    mustBeatLedSuit: boolean;
    beatNotRequiredAfterTrumped: boolean;
    mustOvertrump: boolean;
    whenCannotOvertrump: 'any-trump' | 'any-card';
  };
  scoring: ExpScoringSpec;
  tieBreak: 'fewest-misses' | 'shared';
};

type ExpPhase = 'bidding' | 'playing' | 'game-over';

type ExpSeatInfo = {
  seat: number;
  playerId: string;
  name: string;
  kind: 'human' | 'ai';
  strategy?: string;
};

type ExpTrickPlay = { seat: number; card: ExpCard };

type ExpHandState = {
  cardsPerPlayer: number;
  dealer: number;
  trumpCard: ExpCard;
  trumpCardInDealerHand: boolean;
  trumpSuit: string;
  hands: ExpCard[][];
  bids: (number | null)[];
  tricksWon: number[];
  currentTrick: { leader: number; plays: ExpTrickPlay[] };
  lastTrick?: { winner: number; plays: ExpTrickPlay[] };
  toAct: number;
};

type ExpHandResult = {
  handIndex: number;
  cardsPerPlayer: number;
  dealer: number;
  trumpSuit: string;
  bids: number[];
  tricks: number[];
};

type ExpGameState = {
  schemaVersion: 1;
  gameId: string;
  rules: ExpRuleSet;
  handPlan: number[];
  seats: ExpSeatInfo[];
  seed: string;
  aiDecisionCount: number;
  phase: ExpPhase;
  handIndex: number;
  hand: ExpHandState | null;
  completedHands: ExpHandResult[];
  version: number;
};

type ExpGameEvent =
  | { type: 'game-started'; seats: ExpSeatInfo[]; handPlan: number[] }
  | {
      type: 'hand-dealt';
      handIndex: number;
      dealer: number;
      cardsPerPlayer: number;
      trumpCard: ExpCard;
      trumpCardInDealerHand: boolean;
    }
  | { type: 'bid-made'; seat: number; tricks: number }
  | { type: 'card-played'; seat: number; card: ExpCard }
  | { type: 'trick-won'; seat: number; trickNumber: number }
  | { type: 'hand-completed'; handIndex: number; result: ExpHandResult }
  | { type: 'game-over' };

// ---- Assertions --------------------------------------------------------------------------------

describe('VC-117 domain exports and types', () => {
  test('schemas.ts exports every schema (none is any)', () => {
    expectTypeOf(CardSchema).not.toBeAny();
    expectTypeOf(DeckDefinitionSchema).not.toBeAny();
    expectTypeOf(BoundSchema).not.toBeAny();
    expectTypeOf(SegmentSchema).not.toBeAny();
    expectTypeOf(HandSequenceSpecSchema).not.toBeAny();
    expectTypeOf(ScoringSpecSchema).not.toBeAny();
    expectTypeOf(RuleSetSchema).not.toBeAny();
    expectTypeOf(SeatInfoSchema).not.toBeAny();
    expectTypeOf(TrickPlaySchema).not.toBeAny();
    expectTypeOf(HandStateSchema).not.toBeAny();
    expectTypeOf(HandResultSchema).not.toBeAny();
    expectTypeOf(GameStateSchema).not.toBeAny();
    expectTypeOf(GameEventSchema).not.toBeAny();
  });

  test('cards.ts, decks.ts and presets.ts export their values with the listed signatures', () => {
    expectTypeOf(InvalidCardError).not.toBeAny();
    expectTypeOf<InvalidCardError>().toExtend<Error>();
    expectTypeOf(cardId).toEqualTypeOf<(card: Card) => string>();
    expectTypeOf(parseCard).toEqualTypeOf<(id: string, deck: DeckDefinition) => Card>();
    expectTypeOf(compareRanks).toEqualTypeOf<(deck: DeckDefinition, a: Rank, b: Rank) => number>();
    expectTypeOf(FRENCH_52).toEqualTypeOf<DeckDefinition>();
    expectTypeOf(SPANISH_40).toEqualTypeOf<DeckDefinition>();
    expectTypeOf(buildDeck).toEqualTypeOf<(deck: DeckDefinition, players: number) => Card[]>();
    expectTypeOf(PRESET_IDS).toEqualTypeOf<readonly PresetId[]>();
    expectTypeOf<typeof DEFAULT_PRESET_ID>().toEqualTypeOf<'argentina-fidepo'>();
    expectTypeOf(UnknownPresetError).not.toBeAny();
    expectTypeOf<UnknownPresetError>().toExtend<Error>();
    expectTypeOf(getPreset).toEqualTypeOf<(id: string) => RuleSet>();
  });

  test('Suit, Rank and PresetId have the listed shapes', () => {
    expectTypeOf<Suit>().toEqualTypeOf<string>();
    expectTypeOf<Rank>().toEqualTypeOf<string>();
    expectTypeOf<PresetId>().toEqualTypeOf<ExpPresetId>();
  });

  test('the 13 FR-118 types are not any', () => {
    expectTypeOf<Card>().not.toBeAny();
    expectTypeOf<DeckDefinition>().not.toBeAny();
    expectTypeOf<Bound>().not.toBeAny();
    expectTypeOf<Segment>().not.toBeAny();
    expectTypeOf<HandSequenceSpec>().not.toBeAny();
    expectTypeOf<ScoringSpec>().not.toBeAny();
    expectTypeOf<RuleSet>().not.toBeAny();
    expectTypeOf<SeatInfo>().not.toBeAny();
    expectTypeOf<TrickPlay>().not.toBeAny();
    expectTypeOf<HandState>().not.toBeAny();
    expectTypeOf<HandResult>().not.toBeAny();
    expectTypeOf<GameState>().not.toBeAny();
    expectTypeOf<GameEvent>().not.toBeAny();
  });

  test('the 13 FR-118 types equal the spec listings exactly', () => {
    expectTypeOf<Card>().toEqualTypeOf<ExpCard>();
    expectTypeOf<DeckDefinition>().toEqualTypeOf<ExpDeckDefinition>();
    expectTypeOf<Bound>().toEqualTypeOf<ExpBound>();
    expectTypeOf<Segment>().toEqualTypeOf<ExpSegment>();
    expectTypeOf<HandSequenceSpec>().toEqualTypeOf<ExpHandSequenceSpec>();
    expectTypeOf<ScoringSpec>().toEqualTypeOf<ExpScoringSpec>();
    expectTypeOf<RuleSet>().toEqualTypeOf<ExpRuleSet>();
    expectTypeOf<SeatInfo>().toEqualTypeOf<ExpSeatInfo>();
    expectTypeOf<TrickPlay>().toEqualTypeOf<ExpTrickPlay>();
    expectTypeOf<HandState>().toEqualTypeOf<ExpHandState>();
    expectTypeOf<HandResult>().toEqualTypeOf<ExpHandResult>();
    expectTypeOf<GameState>().toEqualTypeOf<ExpGameState>();
    expectTypeOf<GameEvent>().toEqualTypeOf<ExpGameEvent>();
  });

  test('the spot checks named in VC-117 hold', () => {
    expectTypeOf<GameState['version']>().toEqualTypeOf<number>();
    expectTypeOf<RuleSet['id']>().toEqualTypeOf<PresetId>();
    expectTypeOf<Card>().toEqualTypeOf<{ suit: string; rank: string }>();
    expectTypeOf<GameEvent['type']>().toEqualTypeOf<
      | 'game-started'
      | 'hand-dealt'
      | 'bid-made'
      | 'card-played'
      | 'trick-won'
      | 'hand-completed'
      | 'game-over'
    >();
    expectTypeOf<GameState['phase']>().toEqualTypeOf<Phase>();
    expectTypeOf<Phase>().toEqualTypeOf<ExpPhase>();
  });

  test('the hand-written types in types.ts are exported (none is any)', () => {
    expectTypeOf<Phase>().not.toBeAny();
    expectTypeOf<Move>().not.toBeAny();
    expectTypeOf<LegalMove>().not.toBeAny();
    expectTypeOf<Transition>().not.toBeAny();
    expectTypeOf<Rng>().not.toBeAny();
    expectTypeOf<HandScore>().not.toBeAny();
    expectTypeOf<ScoreBoard>().not.toBeAny();
    expectTypeOf<TableView>().not.toBeAny();
    expectTypeOf<PlayerView>().not.toBeAny();
    expectTypeOf<PlayerUpdate>().not.toBeAny();
    expectTypeOf<DecisionContext>().not.toBeAny();
    expectTypeOf<Decision>().not.toBeAny();
  });
});
