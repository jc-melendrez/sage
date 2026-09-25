import { LanHostServer } from './lanHost';
import { LanClientSession } from './lanClient';
import type { QuizPayload } from './offlineEngine';
import type { LanPlayer } from './lanProtocol';

export interface LanGameContext {
  quiz: QuizPayload | null;
  order: number[];
  timePerQuestion: number;
  playerName: string;
  playerAvatar: string;
  role: string;
  selfPlay: boolean;
  hostIp: string;
  roomCode: string;
}

export const lanGame: LanGameContext = {
  quiz: null,
  order: [],
  timePerQuestion: 30,
  playerName: '',
  playerAvatar: '',
  role: 'student',
  selfPlay: false,
  hostIp: '',
  roomCode: '',
};

export let lanHost: LanHostServer | null = null;
export let lanClient: LanClientSession | null = null;

export function setLanHost(host: LanHostServer | null) {
  lanHost = host;
}

export function setLanClient(client: LanClientSession | null) {
  lanClient = client;
}

export function getLanClient(): LanClientSession | null {
  return lanClient;
}

// Latest roster seen from the host, so screens can seed their player list
// without waiting for the next broadcast (e.g. lobby mounting after join).
let lastLanRoster: LanPlayer[] = [];

export function setLastLanRoster(players: LanPlayer[]) {
  lastLanRoster = players;
}

export function getLastLanRoster(): LanPlayer[] {
  return lastLanRoster;
}

// The host's `welcome` message assigns this device a player id. Used to mark
// "you" on live standings and on the results screen.
let lanPlayerId = '';

export function setLanPlayerId(id: string) {
  lanPlayerId = id;
}

export function getLanPlayerId(): string {
  return lanPlayerId;
}

// Combined final standings for a LAN game before the results screen mounts.
let lanFinalStandings: LanPlayer[] = [];

export function setLanFinalStandings(players: LanPlayer[]) {
  lanFinalStandings = players;
}

export function getLanFinalStandings(): LanPlayer[] {
  return lanFinalStandings;
}

// Host identity received via the `welcome` message, so joiners can show the
// host in the roster slots even when the host only starts playing at START.
let lanHostInfo: { name?: string; avatar?: string } = {};

export function setLanHostInfo(info: { name?: string; avatar?: string }) {
  lanHostInfo = info ?? {};
}

export function getLanHostInfo(): { name?: string; avatar?: string } {
  return lanHostInfo;
}

export function resetLanState() {
  lanGame.quiz = null;
  lanGame.order = [];
  lanGame.timePerQuestion = 30;
  lanGame.playerName = '';
  lanGame.playerAvatar = '';
  lanGame.selfPlay = false;
  lanGame.hostIp = '';
  lanGame.roomCode = '';
  lastLanRoster = [];
  lanPlayerId = '';
  lanFinalStandings = [];
  lanHostInfo = {};
  setLanHost(null);
  setLanClient(null);
}