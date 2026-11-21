import { describe, expect, it, vi } from 'vitest';
import { autoMove } from '@el/engine';
import { RoomError, Rooms } from './rooms';

function lobby(n: number, password?: string) {
  const rooms = new Rooms();
  const { room, member: host } = rooms.create('호스트', password);
  rooms.connect(room, host);
  const others = [];
  for (let i = 1; i < n; i++) {
    const { member } = rooms.join(room.code, { name: `p${i}`, password });
    rooms.connect(room, member);
    others.push(member);
  }
  return { rooms, room, host, others };
}

describe('Rooms', () => {
  it('암호 검증과 토큰 재접속', () => {
    const { rooms, room } = lobby(1, 'secret');
    expect(() => rooms.join(room.code, { name: 'x' })).toThrow(RoomError);
    expect(() => rooms.join(room.code, { name: 'x', password: 'nope' })).toThrow(RoomError);
    const { member } = rooms.join(room.code.toLowerCase(), { name: 'x', password: 'secret' });
    const again = rooms.join(room.code, { name: 'ignored', token: member.token });
    expect(again.member).toBe(member);
    expect(room.members).toHaveLength(2);
  });

  it('5번째는 관전자, 중복 닉네임은 번호', () => {
    const { rooms, room } = lobby(4);
    const { member } = rooms.join(room.code, { name: 'p1' });
    expect(member.role).toBe('spectator');
    expect(member.name).toBe('p12');
  });

  it('방장만 설정/시작, 설정은 정리됨', () => {
    const { rooms, room, host, others } = lobby(2);
    expect(() => rooms.setConfig(room, others[0], { colors: 3 })).toThrow(RoomError);
    rooms.setConfig(room, host, { colors: 6, handSize: 'x' as any, bonusMultiplied: true });
    expect(room.config.colors).toBe(6);
    expect(room.config.handSize).toBe(8);
    expect(() => rooms.start(room, others[0])).toThrow(RoomError);
    rooms.start(room, host);
    expect(room.match?.players).toBe(2);
    expect(host.seat).toBe(0);
  });

  it('방장이 끊기면 다른 플레이어가 이어받음', () => {
    const { rooms, room, host, others } = lobby(2);
    rooms.disconnect(room, host);
    rooms.setConfig(room, others[0], { colors: 4 });
    expect(room.hostId).toBe(others[0].id);
  });

  it('검증 실패 시 시작 불가 (4인 원작 덱 부족)', () => {
    const { rooms, room, host } = lobby(4);
    rooms.setConfig(room, host, { colors: 2 });
    expect(() => rooms.start(room, host)).toThrow(/카드가 부족/);
  });

  it('3인 전체 매치 진행 → 로비 복귀', () => {
    const { rooms, room, host } = lobby(3);
    rooms.setConfig(room, host, { colors: 6, maxValue: 12, rounds: 2 });
    rooms.start(room, host);
    const bySeat = room.members.filter((m) => m.seat !== null).sort((a, b) => a.seat! - b.seat!);
    for (let round = 0; round < 2; round++) {
      let guard = 0;
      while (room.match!.status === 'playing' && guard++ < 2000) {
        const m = room.match!;
        rooms.move(room, bySeat[m.state.turn], autoMove(m));
      }
      if (round === 0) {
        expect(room.match!.status).toBe('round-over');
        rooms.next(room, host);
      }
    }
    expect(room.match!.status).toBe('match-over');
    expect(room.match!.roundScores).toHaveLength(2);
    const v = rooms.view(room, bySeat[1]);
    expect(v.game!.me).toBe(1);
    expect(v.game!.hand).toEqual(room.match!.state.hands[1]);
    rooms.next(room, host);
    expect(room.match).toBeNull();
  });

  it('남의 차례에 두면 거부, 관전자는 못 둠', () => {
    const { rooms, room, host, others } = lobby(2);
    const { member: spec } = rooms.join(room.code, { name: 's', spectator: true });
    rooms.start(room, host);
    const m = room.match!;
    const notTurn = [host, others[0]].find((x) => x.seat !== m.state.turn)!;
    expect(() => rooms.move(room, notTurn, { type: 'draw', source: 'deck' })).toThrow(RoomError);
    expect(() => rooms.move(room, spec, { type: 'draw', source: 'deck' })).toThrow(/관전자/);
    expect(() => rooms.move(room, host, { type: 'bogus' } as any)).toThrow(RoomError);
    expect(rooms.view(room, spec).game!.hand).toEqual([]);
  });

  it('방은 최대 개수까지만, 버려진 방은 정리해 자리를 만듦', () => {
    vi.useFakeTimers();
    const rooms = new Rooms(() => {}, 2);
    const a = rooms.create('a');
    rooms.connect(a.room, a.member);
    const b = rooms.create('b'); // 아무도 접속 안 함
    expect(() => rooms.create('c')).toThrow(/가득/);
    vi.advanceTimersByTime(3 * 60 * 1000);
    const c = rooms.create('c');
    expect(rooms.rooms.has(b.room.code)).toBe(false);
    expect(rooms.rooms.has(a.room.code)).toBe(true);
    expect(rooms.rooms.has(c.room.code)).toBe(true);
    vi.useRealTimers();
  });

  it('턴 타이머 만료 시 자동 진행', () => {
    vi.useFakeTimers();
    const changed = vi.fn();
    const rooms = new Rooms(changed);
    const { room, member: host } = rooms.create('h');
    rooms.connect(room, host);
    const { member: p2 } = rooms.join(room.code, { name: 'b' });
    rooms.connect(room, p2);
    rooms.setConfig(room, host, { turnTimerSec: 30 });
    rooms.start(room, host);
    const t0 = room.match!.state.turn;
    vi.advanceTimersByTime(30_000);
    expect(room.match!.state.turn).not.toBe(t0);
    expect(changed).toHaveBeenCalled();
    vi.useRealTimers();
  });
});
