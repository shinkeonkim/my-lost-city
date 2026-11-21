import { randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';
import {
  CLASSIC,
  GameConfig,
  RoomView,
  MatchState,
  Move,
  MoveError,
  applyMove,
  autoMove,
  deckSize,
  expectedTurns,
  newMatch,
  sanitizeConfig,
  startNextRound,
  validateConfig,
  viewFor,
} from '@el/engine';

export const MAX_PLAYERS = 4;
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const IDLE_ROOM_MS = 30 * 60 * 1000;
/** 방이 가득 찼을 때, 아무도 접속해 있지 않은 방은 이 시간이 지나면 정리해 자리를 만든다 */
const ABANDONED_ROOM_MS = 2 * 60 * 1000;
export const MAX_ROOMS = Math.max(1, Number(process.env.MAX_ROOMS ?? 5) || 5);

const rng = () => randomInt(0, 2 ** 32) / 2 ** 32;

export interface Member {
  id: string;
  token: string;
  name: string;
  role: 'player' | 'spectator';
  /** 게임 중 좌석 번호 */
  seat: number | null;
  connections: number;
}

export interface Room {
  code: string;
  password: { salt: Buffer; hash: Buffer } | null;
  hostId: string;
  config: GameConfig;
  members: Member[];
  match: MatchState | null;
  turnDeadline: number | null;
  timer: NodeJS.Timeout | null;
  lastActive: number;
}

export class RoomError extends Error {}

type Listener = (room: Room) => void;

export class Rooms {
  rooms = new Map<string, Room>();
  constructor(
    private onChange: Listener = () => {},
    private maxRooms = MAX_ROOMS,
  ) {}

  private newCode(): string {
    for (let i = 0; i < 1000; i++) {
      let code = '';
      for (let j = 0; j < 4; j++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
      if (!this.rooms.has(code)) return code;
    }
    throw new RoomError('방을 더 만들 수 없습니다');
  }

  get(code: string): Room {
    const room = this.rooms.get(normalizeCode(code));
    if (!room) throw new RoomError('방을 찾을 수 없습니다');
    return room;
  }

  create(name: string, password?: string): { room: Room; member: Member } {
    if (this.rooms.size >= this.maxRooms) this.sweep(Date.now(), ABANDONED_ROOM_MS);
    if (this.rooms.size >= this.maxRooms) {
      throw new RoomError(`지금은 방이 가득 찼습니다 (최대 ${this.maxRooms}개). 잠시 후 다시 시도하거나 기존 방에 참가하세요`);
    }
    const code = this.newCode();
    const member = makeMember(name, 'player');
    const room: Room = {
      code,
      password: password ? hashPassword(password) : null,
      hostId: member.id,
      config: { ...CLASSIC },
      members: [member],
      match: null,
      turnDeadline: null,
      timer: null,
      lastActive: Date.now(),
    };
    this.rooms.set(code, room);
    return { room, member };
  }

  /** 토큰이 있으면 재접속, 없으면 새 참가 */
  join(code: string, opts: { name: string; password?: string; token?: string; spectator?: boolean }): { room: Room; member: Member } {
    const room = this.get(code);
    if (opts.token) {
      const existing = room.members.find((m) => m.token === opts.token);
      if (existing) return { room, member: existing };
    }
    if (room.password && !checkPassword(room.password, opts.password ?? '')) throw new RoomError('암호가 틀렸습니다');
    const playerCount = room.members.filter((m) => m.role === 'player').length;
    const asPlayer = !opts.spectator && !room.match && playerCount < MAX_PLAYERS;
    const member = makeMember(uniqueName(room, opts.name), asPlayer ? 'player' : 'spectator');
    room.members.push(member);
    this.touch(room);
    return { room, member };
  }

  connect(room: Room, member: Member) {
    member.connections++;
    this.touch(room);
  }

  disconnect(room: Room, member: Member) {
    member.connections = Math.max(0, member.connections - 1);
    if (member.connections === 0 && !room.match && member.role === 'spectator') {
      // 로비 관전자는 끊기면 정리
      room.members = room.members.filter((m) => m !== member);
    }
    this.touch(room);
  }

  leave(room: Room, member: Member) {
    if (room.match && member.seat !== null && room.match.status !== 'match-over') {
      throw new RoomError('게임 중에는 나갈 수 없습니다 (연결을 끊으면 다시 들어올 수 있어요)');
    }
    room.members = room.members.filter((m) => m !== member);
    if (room.members.length === 0) return this.remove(room);
    this.ensureHost(room);
    this.touch(room);
  }

  kick(room: Room, by: Member, targetId: string) {
    this.requireHost(room, by);
    if (room.match) throw new RoomError('게임 중에는 내보낼 수 없습니다');
    if (targetId === by.id) throw new RoomError('자기 자신은 내보낼 수 없습니다');
    room.members = room.members.filter((m) => m.id !== targetId);
    this.touch(room);
  }

  setRole(room: Room, member: Member, role: Member['role']) {
    if (room.match) throw new RoomError('게임 중에는 바꿀 수 없습니다');
    if (role === 'player' && member.role !== 'player') {
      if (room.members.filter((m) => m.role === 'player').length >= MAX_PLAYERS) throw new RoomError(`플레이어는 최대 ${MAX_PLAYERS}명입니다`);
    }
    member.role = role;
    this.touch(room);
  }

  /** 로비에서 플레이어 순서 이동 */
  moveMember(room: Room, by: Member, targetId: string, dir: -1 | 1) {
    this.requireHost(room, by);
    if (room.match) throw new RoomError('게임 중에는 바꿀 수 없습니다');
    const i = room.members.findIndex((m) => m.id === targetId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= room.members.length) return;
    [room.members[i], room.members[j]] = [room.members[j], room.members[i]];
    this.touch(room);
  }

  setConfig(room: Room, by: Member, input: Partial<GameConfig>) {
    this.requireHost(room, by);
    if (room.match) throw new RoomError('게임 중에는 설정을 바꿀 수 없습니다');
    room.config = sanitizeConfig({ ...room.config, ...input });
    this.touch(room);
  }

  setPassword(room: Room, by: Member, password: string | null) {
    this.requireHost(room, by);
    room.password = password ? hashPassword(password) : null;
    this.touch(room);
  }

  start(room: Room, by: Member) {
    this.requireHost(room, by);
    if (room.match && room.match.status !== 'match-over') throw new RoomError('이미 게임 중입니다');
    const players = room.members.filter((m) => m.role === 'player');
    const errors = validateConfig(room.config, players.length);
    if (errors.length) throw new RoomError(errors[0]);
    room.members.forEach((m) => (m.seat = null));
    players.forEach((m, i) => (m.seat = i));
    room.match = newMatch(room.config, players.length, rng);
    this.resetTimer(room);
    this.touch(room);
  }

  move(room: Room, member: Member, move: Move) {
    const match = room.match;
    if (!match) throw new RoomError('게임이 시작되지 않았습니다');
    if (member.seat === null) throw new RoomError('관전자는 플레이할 수 없습니다');
    if (!isMove(move)) throw new RoomError('잘못된 요청입니다');
    const before = match.state.turn;
    const beforeRound = match.round;
    try {
      applyMove(match, member.seat, move);
    } catch (e) {
      if (e instanceof MoveError) throw new RoomError(e.message);
      throw e;
    }
    if (match.state.turn !== before || match.round !== beforeRound || match.status !== 'playing') this.resetTimer(room);
    this.touch(room);
  }

  /** 다음 판 시작 또는 (매치 종료 후) 로비로 */
  next(room: Room, by: Member) {
    const match = room.match;
    if (!match) throw new RoomError('게임이 없습니다');
    if (by.seat === null && by.id !== room.hostId) throw new RoomError('플레이어만 진행할 수 있습니다');
    if (match.status === 'round-over') {
      startNextRound(match, rng);
      this.resetTimer(room);
    } else if (match.status === 'match-over') {
      room.match = null;
      room.members.forEach((m) => (m.seat = null));
      this.clearTimer(room);
    } else {
      throw new RoomError('판이 아직 끝나지 않았습니다');
    }
    this.touch(room);
  }

  /** 시간 초과: 현재 차례를 자동으로 진행 */
  timeout(room: Room) {
    const match = room.match;
    if (!match || match.status !== 'playing') return;
    const turn = match.state.turn;
    let guard = 0;
    while (match.status === 'playing' && match.state.turn === turn && guard++ < 3) {
      applyMove(match, turn, autoMove(match));
    }
    this.resetTimer(room);
    this.touch(room);
  }

  private resetTimer(room: Room) {
    this.clearTimer(room);
    const sec = room.match?.config.turnTimerSec ?? 0;
    if (!room.match || room.match.status !== 'playing' || sec <= 0) return;
    room.turnDeadline = Date.now() + sec * 1000;
    room.timer = setTimeout(() => {
      room.timer = null;
      this.timeout(room);
      this.onChange(room);
    }, sec * 1000);
    room.timer.unref?.();
  }

  private clearTimer(room: Room) {
    if (room.timer) clearTimeout(room.timer);
    room.timer = null;
    room.turnDeadline = null;
  }

  private ensureHost(room: Room) {
    const host = room.members.find((m) => m.id === room.hostId);
    if (host && host.connections > 0) return;
    const next = room.members.find((m) => m.connections > 0 && m.role === 'player') ?? room.members.find((m) => m.connections > 0);
    if (next) room.hostId = next.id;
    else if (!host && room.members[0]) room.hostId = room.members[0].id;
  }

  private requireHost(room: Room, m: Member) {
    // 방장이 접속해 있지 않으면 요청한 플레이어가 방장을 이어받는다
    const host = room.members.find((x) => x.id === room.hostId);
    if ((!host || host.connections === 0) && m.connections > 0 && m.role === 'player') room.hostId = m.id;
    if (room.hostId !== m.id) throw new RoomError('방장만 할 수 있습니다');
  }

  private touch(room: Room) {
    room.lastActive = Date.now();
  }

  remove(room: Room) {
    this.clearTimer(room);
    this.rooms.delete(room.code);
  }

  /** 아무도 접속하지 않은 채 오래된 방 정리 */
  sweep(now = Date.now(), idleMs = IDLE_ROOM_MS) {
    for (const room of this.rooms.values()) {
      const anyone = room.members.some((m) => m.connections > 0);
      if (!anyone && now - room.lastActive > idleMs) this.remove(room);
    }
  }

  view(room: Room, member: Member): RoomView {
    const players = room.members.filter((m) => m.role === 'player');
    const seats: string[] = [];
    for (const m of room.members) if (m.seat !== null) seats[m.seat] = m.name;
    return {
      code: room.code,
      hasPassword: !!room.password,
      you: member.id,
      hostId: room.hostId,
      members: room.members.map((m) => ({
        id: m.id,
        name: m.name,
        role: m.role,
        seat: m.seat,
        connected: m.connections > 0,
        isHost: m.id === room.hostId,
      })),
      config: room.config,
      lobby: {
        playerCount: players.length,
        deckSize: deckSize(room.config),
        expectedTurns: Math.round(expectedTurns(room.config, Math.max(players.length, 2)) * 10) / 10,
        errors: validateConfig(room.config, Math.max(players.length, 2)).concat(players.length < 2 ? ['플레이어가 2명 이상 필요합니다'] : []),
      },
      game: room.match ? viewFor(room.match, member.seat ?? -1) : null,
      seats,
      turnDeadline: room.turnDeadline,
    };
  }
}

function makeMember(name: string, role: Member['role']): Member {
  return {
    id: randomBytes(6).toString('hex'),
    token: randomBytes(18).toString('base64url'),
    name: cleanName(name),
    role,
    seat: null,
    connections: 0,
  };
}

export function cleanName(name: unknown): string {
  const s = typeof name === 'string' ? name.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 16) : '';
  return s || '탐험가';
}

function uniqueName(room: Room, name: string): string {
  const base = cleanName(name);
  let n = base;
  let i = 2;
  while (room.members.some((m) => m.name === n)) n = `${base}${i++}`;
  return n;
}

export function normalizeCode(code: unknown): string {
  return typeof code === 'string' ? code.trim().toUpperCase() : '';
}

function hashPassword(pw: string) {
  const salt = randomBytes(16);
  return { salt, hash: scryptSync(pw.slice(0, 64), salt, 32) };
}

function checkPassword(p: { salt: Buffer; hash: Buffer }, pw: string): boolean {
  const h = scryptSync(String(pw).slice(0, 64), p.salt, 32);
  return timingSafeEqual(h, p.hash);
}

function isMove(m: any): m is Move {
  if (!m || typeof m !== 'object') return false;
  if ((m.type === 'play' || m.type === 'discard') && typeof m.cardId === 'string') return true;
  if (m.type === 'draw' && (m.source === 'deck' || Number.isInteger(m.source))) return true;
  return false;
}
