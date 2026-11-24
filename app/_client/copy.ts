// All Spanish UI copy (plan P-9), with the exact texts of spec 09. Components and tests import
// from here. Functions take the values of a template.
export const COPY = {
  // New game (FR-900, FR-903, FR-904)
  nameLabel: 'Tu nombre',
  aiCountLabel: 'Rivales',
  startGame: 'Empezar partida',
  createFailed: 'No se pudo crear la partida. Probá de nuevo.',
  createInvalid: 'Revisá los datos de la partida.',
  continueGame: 'Continuar partida',

  // Loading the game page (FR-905, FR-907, FR-908)
  noAccess: 'No tenés acceso a esta partida.',
  newGame: 'Nueva partida',
  accessInvalid: 'Tu acceso a esta partida ya no es válido.',
  gameGone: 'La partida ya no existe.',
  gameUnsupported: 'La partida no se puede continuar con esta versión del juego.',
  loadFailed: 'No se pudo cargar la partida.',
  retry: 'Reintentar',

  // Copy the spec gives no text for (Iteration 4, D-017): minimal Spanish labels.
  title: 'La Podrida',
  loading: 'Cargando…',
  dealerMarker: 'Repartidor',
  turnMarker: 'Turno',
  seatCards: 'Cartas',
  seatBid: 'Pedido',
  seatTricks: 'Bazas',
  trumpLabel: 'Triunfo',
  currentTrickLabel: 'Baza actual',
  lastTrickLabel: 'Última baza',
  lastTrickWinner: (name: string): string => `Ganó ${name}`,
  yourHandLabel: 'Tu mano',
  seatFallback: (seat: number): string => `Asiento ${seat + 1}`,

  // Moves (FR-917, FR-918)
  moveFailed: 'No se pudo enviar la jugada.',
  moveConflict: 'La partida avanzó; se actualizó la mesa.',
  moveIllegal: 'Esa jugada ya no es válida.',
  moveUnexpected: 'Error inesperado.',

  // Animation (FR-921, FR-923)
  skip: 'Saltar',
  handCompleted: (handIndex: number): string => `Fin de la mano ${handIndex + 1}`,

  // Table (FR-925)
  you: '(vos)',
  noBid: '—',
  trumpInDealerHand: 'En mano del repartidor',
  handLine: (handIndex: number, handCount: number, cards: number): string =>
    `Mano ${handIndex + 1} de ${handCount} · ${cards} cartas`,

  // Score sheet (FR-927, FR-928)
  scoreSheet: 'Planilla',
  close: 'Cerrar',
  liveStatus: {
    'on-track': 'En camino',
    'made-so-far': 'Cumplida',
    busted: 'Pasada',
  },
} as const;
