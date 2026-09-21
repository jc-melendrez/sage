# ASSET-POLISH.md — hands-off handoff for swapping placeholder icons/images

This doc lists every spot that uses an **emoji or text as an icon**, or a **default Expo
template asset**, so anyone on the team can swap in real icons/images without touching the
backend. Files referenced from the repo root (`mobile_app/…`, `backend_api/…`).

## Icon conventions already in the app (reuse these)

Most screens already use the real icon libs — use the same pattern so swaps are consistent:

```tsx
import Ionicons from '@expo/vector-icons/Ionicons';

<Ionicons name="trophy" size={18} color="#F59E0B" />
```

or the Tabler set (used in some layouts):

```tsx
import { IconTrophy } from '@tabler/icons-react-native';
```

Images (for custom assets):

```tsx
import { Image } from 'react-native';

<Image source={require('../assets/images/my-badge-gold.png')} style={{ width: 40, height: 40 }} />
```

**Ionicons names already proven in this repo** (safe to reuse):
`book`, `book-outline`, `bulb`, `brain`, `calendar`, `chatbubbles`, `checkmark`, `checkmark-done`,
`checkbox`, `create`, `flag`, `flame`, `flash`, `flask`, `game-controller-outline`, `help-circle`,
`help-circle-outline`, `list`, `lock-closed`, `people`, `play`, `refresh`, `school-outline`,
`shield`, `shield-checkmark-outline`, `snow`, `sparkles`, `time`, `timer`, `trending-down`,
`trending-up`, `trophy`, `warning`, `albums`, `person`, `alert-circle`, `close-circle`,
`document-text-outline`, `pulse-outline`, `server-outline`, `person-add-outline`, `flag-outline`.

Suggested-but-unverified names (confirm in
`node_modules/@expo/vector-icons/glyphmaps/Ionicons.json` before using):
`medal`, `medal-outline`, `crown`, `dice`, `dice-outline`, `radio-button-on`.

---

## A. Emoji used as icons → swap for Ionicons / custom images

### 1. Podium medals & crowns 🥇 🥈 🥉 👑

| File:line | Current | Suggested | Note |
|---|---|---|---|
| `mobile_app/app/game/final.tsx:127` | 🥈 | `Ionicons name="medal" color={rankColor}` | 2nd-place podium |
| `mobile_app/app/game/final.tsx:134` | 👑 | `crown` or `trophy` | 1st place, above the gold medal |
| `mobile_app/app/game/final.tsx:135` | 🥇 | `medal` color gold | |
| `mobile_app/app/game/final.tsx:142` | 🥉 | `medal` color bronze | |
| `mobile_app/app/game/question.tsx:88` | 🥇🥈🥉 | `medal` (color per index) | Scoreboard row; `medal || index+1` |
| `mobile_app/app/game/question.tsx:1159` | 🥇🥈🥉 | `medal` | Standings rank column |
| `mobile_app/app/game/lobby.tsx:404` | 👑 | `crown` | Host tag next to host name |
| `mobile_app/app/tv/[roomCode].tsx:74` | `MEDALS = ['🥇','🥈','🥉']` | `const MEDALS = ['gold','silver','bronze']` mapped to `medal` icon | TV big-screen podium |
| `mobile_app/app/educator/(tabs)/host-session.tsx:55` | `MEDALS = ['🥇','🥈','🥉']` | same as above | Host preview podium |
| `mobile_app/app/(tabs)/leaderboard.tsx:50-52` | 🥇🥈🥉 in medal map | `medal` icon + gradient `bg` stays | change `medal` field to an icon name/asset |

Also inline streak flames on leaderboard: `mobile_app/app/(tabs)/leaderboard.tsx:186` and `:226` — 🔥 → `<Ionicons name="flame" />` in the rank meta.

### 2. Power-ups ❄️ 💡 ⚡ 🛡️

| File:line | Current | Suggested | Note |
|---|---|---|---|
| `mobile_app/app/game/question.tsx:122-125` | `❄️💡⚡🛡️` in `POWERUP_ITEMS` | `snow`, `bulb`, `flash`, `shield` (already used!) | ⚠️ `mobile_app/components/game/LanPlaySurface.tsx:207-210` already uses Ionicons `snow/bulb/flash/shield` for the same power-ups — copy its pattern so both screens match |
| `mobile_app/app/game/question.tsx:973` | 💡 | `bulb` | hint text line |
| `mobile_app/app/game/question.tsx:1076` | 💡 | `bulb` | powerup modal |
| `mobile_app/app/game/question.tsx:1088` | ⚡ | `flash` | powerup modal |

### 3. Other game-screen symbols

| File:line | Current | Suggested |
|---|---|---|
| `mobile_app/app/game/question.tsx:108` | 🔥 streak | `<Ionicons name="flame" />` |
| `mobile_app/app/game/question.tsx:792` | 🏆 standings toggle | `trophy` |
| `mobile_app/app/game/question.tsx:833` | ⚡ 2x Points banner | `flash` |
| `mobile_app/app/game/question.tsx:905` | ✅ / ✗ correct / wrong | `checkmark-circle` / `close-circle` |
| `mobile_app/app/game/question.tsx:1043` | 🏁 Finish | `flag` (checkered-flag image if you want) |
| `mobile_app/app/game/question.tsx:1148` | 🚀 mover banner | `rocket` (not yet in repo) or `trending-up` |
| `mobile_app/components/TeamRevealOverlay.tsx:140` | 🎲 dice | `dice` (unverified) or a small dice PNG asset; alt `shuffle` |
| `mobile_app/components/hello-wave.tsx:16` | 👋 | only used by the template screen (see B) — delete with it |

### 4. Badges (⚠️ emoji comes from the API/DB — needs coordinated change)

Badge icons are **emoji strings saved in the database** and returned over the API. Swapping
them is a two-side change; don't do half or badges will look broken:

- Icon source (backend): `backend_api/core/users/gamification.py:33-38` (`📚⭐🌟💎🔥`),
  `:74` (`🎯`), `:78` (`💯`), `:163` (`🏆`) — the values stored in `Badge.icon`.
- Renderers (mobile):
  - `mobile_app/components/Dashboard.tsx:640` — `{badge.icon || badge.icon_url || '🏆'}`
  - `mobile_app/app/(tabs)/profile.tsx:236` — same pattern
  - Mock/educator data: `mobile_app/constants/educatorMockData.ts:57-139` (🔥📚🏆) →
    rendered at `mobile_app/app/educator/(tabs)/student-detail.tsx:106` (`{b.emoji}`)

Two acceptable directions:
1. **Keep emoji but standardize** — leave `Badge.icon` as-is; just drop the `|| '🏆'` fallback
   and make sure every badge has an icon. Smallest effort.
2. **Real badge images** — change `Badge.icon` to a stable key or URL and render `<Image>`
   (needs a backend `gamification.py` + DB **and** a mobile renderer change together).

### 5. Chat reactions (low priority — emoji is fine here)

`mobile_app/app/chat/[groupId].tsx:43` — 👍❤️😂😮😢 quick-reaction buttons. These are genuine
reaction emoji; only replace if you want a consistent look.

---

## B. Default Expo template leftovers (real asset problem)

- `mobile_app/app/(tabs)/explore.tsx` — the **entire screen is the unmodified Expo starter
  template**: shows `react-logo.png`, links to reactnative.dev / expo docs, references
  `HelloWave`. It is hidden from the tabs (`href: null` in `(tabs)/_layout.tsx`).
  → **Replace with real content** (or delete the screen + its route).
- `mobile_app/assets/images/react-logo.png`, `react-logo@2x.png`, `react-logo@3x.png`,
  `partial-react-logo.png` — template images, only `react-logo.png` is referenced (from
  `explore.tsx:61`). Safe to delete once explore is redone.

---

## C. Already real assets (no action needed)

- Avatars: `mobile_app/assets/pfp/*.png` (17 animal PNGs) wired through
  `mobile_app/constants/pfps.ts` — good.
- App icon / splash / adaptive icon files referenced in `mobile_app/app.config.js` — all exist.

---

## Suggested new asset work (nice-to-have, if the group wants)

- `medal-gold.png`, `medal-silver.png`, `medal-bronze.png` (or one icon + colors)
- `crown.png` for hosts
- `dice.png` for the team-reveal roll
- Checkered-flag image for the "Finish 🏁" button
- Real home-screen hero image and category thumbnails to replace template `explore` screen content