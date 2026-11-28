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

  // Rules dialog
  rules: 'Reglas',
  rulesTitle: 'Reglas de La Podrida',
  rulesSections: [
    {
      heading: 'Objetivo',
      items: [
        'Es un juego de bazas en el que tenés que acertar exactamente cuántas bazas vas a ganar en cada mano.',
        'Si ganás más o menos bazas de las que pediste, no cumplís.',
      ],
    },
    {
      heading: 'Reparto y triunfo',
      items: [
        'Se juega con mazo francés de 52 cartas, de 3 a 6 jugadores.',
        'El repartidor da a cada jugador la cantidad de cartas de la mano. Esa cantidad cambia en cada mano: baja desde el máximo hasta 5, se juegan tantas manos de 4 cartas como jugadores haya, y luego sube de nuevo hasta el máximo.',
        'Se da vuelta la siguiente carta del mazo: su palo es el triunfo. Si se repartió todo el mazo, el triunfo lo marca la última carta del repartidor.',
      ],
    },
    {
      heading: 'Pedir',
      items: [
        'Empezando por el jugador a la derecha del repartidor, cada uno dice cuántas bazas cree que va a ganar. Se puede pedir cero.',
        'El repartidor pide último y no puede pedir un número que haga que la suma de los pedidos sea igual a la cantidad de bazas de la mano (así siempre hay al menos un jugador que no cumple).',
      ],
    },
    {
      heading: 'Jugar',
      items: [
        'El jugador mano sale con la carta que quiera; los demás juegan en orden.',
        'Hay que responder al palo: si tenés una carta del palo de salida, tenés que jugarla. No es obligatorio matar.',
        'Si no tenés del palo, tenés que jugar un triunfo (fallar). Si tampoco tenés triunfo, jugás cualquier carta.',
        'La baza la gana el triunfo más alto; si nadie jugó triunfo, la carta más alta del palo de salida. Quien gana la baza sale en la siguiente.',
      ],
    },
    {
      heading: 'Puntaje',
      items: [
        'Si cumplís tu pedido: 10 puntos de bonificación más 1 punto por baza ganada.',
        'Si no cumplís: solo 1 punto por baza ganada, sin bonificación.',
        'Al final de todas las manos gana quien tenga más puntos. En caso de empate, gana quien haya fallado menos pedidos.',
      ],
    },
  ],
  liveStatus: {
    'on-track': 'En camino',
    'made-so-far': 'Cumplida',
    busted: 'Pasada',
  },
  // Copy the spec gives no text for (Iteration 6, D-025): score-sheet headings, game-over title.
  handNumber: '#',
  points: 'Puntos',
  total: 'Total',
  gameOverTitle: 'Fin de la partida',
} as const;
