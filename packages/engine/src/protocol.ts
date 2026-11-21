import type { GameConfig } from './config';
import type { GameView } from './view';

/** 서버 ↔ 클라이언트 공용 타입 */
export interface MemberPublic {
  id: string;
  name: string;
  role: 'player' | 'spectator';
  seat: number | null;
  connected: boolean;
  /** 연결이 끊긴 지 몇 ms 지났는지 (접속 중이면 null) */
  awayMs: number | null;
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
  /** 턴 제한시간이 있을 때 남은 ms (서버 시각 기준 계산 — 기기 시계 오차 영향 없음) */
  turnRemainingMs: number | null;
  /** 현재 차례인 사람이 끊겨서 다른 사람이 대신 진행할 수 있기까지 남은 ms (해당 없으면 null) */
  nudgeInMs: number | null;
}
