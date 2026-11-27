import { describe, expect, it } from 'vitest';
import { COPY } from '@/app/_client/copy';

// Each text is typed here once, verbatim from spec 09; the components import `COPY` instead.
describe('COPY (FR texts, verbatim)', () => {
  it('new game: FR-900, FR-903, FR-904', () => {
    expect(COPY.nameLabel).toBe('Tu nombre');
    expect(COPY.aiCountLabel).toBe('Rivales');
    expect(COPY.startGame).toBe('Empezar partida');
    expect(COPY.createFailed).toBe('No se pudo crear la partida. Probá de nuevo.');
    expect(COPY.createInvalid).toBe('Revisá los datos de la partida.');
    expect(COPY.continueGame).toBe('Continuar partida');
  });

  it('loading: FR-905, FR-907, FR-908', () => {
    expect(COPY.noAccess).toBe('No tenés acceso a esta partida.');
    expect(COPY.newGame).toBe('Nueva partida');
    expect(COPY.accessInvalid).toBe('Tu acceso a esta partida ya no es válido.');
    expect(COPY.gameGone).toBe('La partida ya no existe.');
    expect(COPY.gameUnsupported).toBe(
      'La partida no se puede continuar con esta versión del juego.',
    );
    expect(COPY.loadFailed).toBe('No se pudo cargar la partida.');
    expect(COPY.retry).toBe('Reintentar');
  });

  it('moves: FR-917, FR-918', () => {
    expect(COPY.moveFailed).toBe('No se pudo enviar la jugada.');
    expect(COPY.moveConflict).toBe('La partida avanzó; se actualizó la mesa.');
    expect(COPY.moveIllegal).toBe('Esa jugada ya no es válida.');
    expect(COPY.moveUnexpected).toBe('Error inesperado.');
  });

  it('animation and table: FR-921, FR-923, FR-925', () => {
    expect(COPY.skip).toBe('Saltar');
    expect(COPY.handCompleted(0)).toBe('Fin de la mano 1');
    expect(COPY.handCompleted(4)).toBe('Fin de la mano 5');
    expect(COPY.you).toBe('(vos)');
    expect(COPY.noBid).toBe('—');
    expect(COPY.trumpInDealerHand).toBe('En mano del repartidor');
    expect(COPY.handLine(2, 28, 3)).toBe('Mano 3 de 28 · 3 cartas');
  });

  it('score sheet: FR-927, FR-928', () => {
    expect(COPY.scoreSheet).toBe('Planilla');
    expect(COPY.close).toBe('Cerrar');
    expect(COPY.liveStatus).toEqual({
      'on-track': 'En camino',
      'made-so-far': 'Cumplida',
      busted: 'Pasada',
    });
  });
});
