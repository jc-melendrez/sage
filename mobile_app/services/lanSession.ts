import { LanHostServer } from './lanHost';
import { LanClientSession } from './lanClient';
import type { QuizPayload } from './offlineEngine';

export interface LanGameContext {
  quiz: QuizPayload | null;
  order: number[];
  timePerQuestion: number;
  playerName: string;
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

export function resetLanState() {
  lanGame.quiz = null;
  lanGame.order = [];
  lanGame.timePerQuestion = 30;
  lanGame.playerName = '';
  lanGame.selfPlay = false;
  lanGame.hostIp = '';
  lanGame.roomCode = '';
  setLanHost(null);
  setLanClient(null);
}