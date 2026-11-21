import type { GameConfig } from './config';
import type { GameView } from './view';

/** 서버 ↔ 클라이언트 공용 타입 */
export interface MemberPublic {
  id: string;
  name: string;
  role: 'player' | 'spectator';
  seat: number | null;
  connected: boolean;
  isHost: boolean;
}

export interface RoomView {
  code: string;
  hasPassword: boolean;
  you: string;
  hostId: string;
  members: MemberPublic[];
  config: GameConfig;
  lobby: { playerCount: number; deckSize: number; expectedTurns: number; errors: string[] };
  game: GameView | null;
  /** seat → 이름 */
  seats: string[];
  turnDeadline: number | null;
}
