import { GamePage } from '@/app/_client/game-page';

export default async function GameRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <GamePage key={id} id={id} />;
}
