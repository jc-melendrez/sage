export type Rating = 'again' | 'hard' | 'good' | 'easy';

export type CardStateName = 'new' | 'learning' | 'review' | 'relearning';

export type Maturity = 'new' | 'learning' | 'mature';

export interface CardState {
  reps: number;
  lapses: number;
  intervalDays: number;
  ease: number;
  due: string;
  state: CardStateName;
  lastReview: string | null;
}

export const MIN_EASE = 1.3;
export const MAX_EASE = 3.0;
export const MATURE_DAYS = 21;

const DAY_MS = 86400000;
const MINUTE_MS = 60000;

export function newCardState(): CardState {
  return {
    reps: 0,
    lapses: 0,
    intervalDays: 0,
    ease: 2.5,
    due: new Date().toISOString(),
    state: 'new',
    lastReview: null,
  };
}

export function gradeCard(state: CardState, rating: Rating, now: Date = new Date()): CardState {
  const next: CardState = { ...state };
  const addDays = (d: number) => new Date(now.getTime() + d * DAY_MS).toISOString();
  const addMinutes = (m: number) => new Date(now.getTime() + m * MINUTE_MS).toISOString();

  next.reps += 1;
  next.lastReview = now.toISOString();

  if (state.state === 'new') {
    switch (rating) {
      case 'again':
        next.state = 'learning';
        next.intervalDays = 0;
        next.due = addMinutes(10);
        break;
      case 'hard':
        next.state = 'learning';
        next.intervalDays = 1;
        next.due = addDays(1);
        break;
      case 'good':
        next.state = 'learning';
        next.intervalDays = 3;
        next.due = addDays(3);
        break;
      case 'easy':
        next.state = 'review';
        next.intervalDays = 7;
        next.due = addDays(7);
        break;
    }
    return next;
  }

  const fresh = state.intervalDays < 1;
  if (state.state === 'learning' || state.state === 'relearning' || fresh) {
    switch (rating) {
      case 'again':
        next.lapses += 1;
        next.state = 'relearning';
        next.intervalDays = 0;
        next.due = addMinutes(10);
        break;
      case 'hard':
        next.state = 'learning';
        next.intervalDays = 1;
        next.due = addDays(1);
        break;
      case 'good':
        if (fresh) {
          next.state = 'learning';
          next.intervalDays = 3;
          next.due = addDays(3);
        } else {
          next.intervalDays = Math.max(1, Math.round(state.intervalDays * state.ease));
          next.state = 'review';
          next.due = addDays(next.intervalDays);
        }
        break;
      case 'easy':
        if (fresh) {
          next.state = 'review';
          next.intervalDays = 7;
          next.due = addDays(7);
        } else {
          next.intervalDays = Math.max(1, Math.round(state.intervalDays * state.ease * 1.3));
          next.state = 'review';
          next.due = addDays(next.intervalDays);
          next.ease = Math.min(MAX_EASE, state.ease + 0.15);
        }
        break;
    }
    return next;
  }

  switch (rating) {
    case 'again':
      next.lapses += 1;
      next.state = 'relearning';
      next.intervalDays = 0;
      next.due = addMinutes(10);
      next.ease = Math.max(MIN_EASE, state.ease - 0.15);
      break;
    case 'hard':
      next.intervalDays = Math.max(1, Math.round(state.intervalDays * 1.2));
      next.ease = Math.max(MIN_EASE, state.ease - 0.15);
      next.state = 'review';
      next.due = addDays(next.intervalDays);
      break;
    case 'good':
      next.intervalDays = Math.max(1, Math.round(state.intervalDays * state.ease));
      next.state = 'review';
      next.due = addDays(next.intervalDays);
      break;
    case 'easy':
      next.intervalDays = Math.max(1, Math.round(state.intervalDays * state.ease * 1.3));
      next.ease = Math.min(MAX_EASE, state.ease + 0.15);
      next.state = 'review';
      next.due = addDays(next.intervalDays);
      break;
  }
  return next;
}

export function isDue(state: CardState, now: Date = new Date()): boolean {
  return state.state === 'new' || new Date(state.due).getTime() <= now.getTime();
}

export function maturityOf(state: CardState): Maturity {
  if (state.state === 'new') return 'new';
  return state.intervalDays >= MATURE_DAYS ? 'mature' : 'learning';
}

export function intervalLabel(state: CardState, rating: Rating, now: Date = new Date()): string {
  const next = gradeCard(state, rating, now);
  const ms = Math.max(0, new Date(next.due).getTime() - now.getTime());
  const minutes = Math.round(ms / MINUTE_MS);
  if (minutes < 60) return `${Math.max(1, minutes)}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.round(days / 7);
  if (weeks < 5) return `${weeks}wk`;
  return `${Math.round(days / 30)}mo`;
}

export const RATING_LABELS: Record<Rating, string> = {
  again: 'Again',
  hard: 'Hard',
  good: 'Good',
  easy: 'Easy',
};

export const RATINGS: Rating[] = ['again', 'hard', 'good', 'easy'];
