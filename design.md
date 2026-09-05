# SAGE — Product Design Rules

## Product identity

> **A playful classroom companion that comes alive when there's something to do.**

SAGE is not a daily-habit learning app. The teacher is the source of content and
events; SAGE is the place where students experience them.

Students open SAGE to participate in something — a hosted game, an assigned
lesson, a group challenge — do it, play it, learn it, and leave.

## The core rule

> **SAGE is not a daily-habit learning app. Do not design around daily streaks,
> daily goals, or forcing users to return every day. SAGE is an event- and
> activity-driven classroom companion. Users primarily open the app when they
> have a teacher-assigned lesson, course activity, hosted game, group challenge,
> or other learning activity to participate in. Gamification should emphasize
> anticipation, participation, competition/cooperation, immediate feedback,
> rewards, and completion rather than habit retention.**

Any feature or UI that nudges users to "come back tomorrow" is off-direction.

## The game loop

The excitement comes from **what the teacher/group has prepared**:

```text
Teacher creates activity
        ↓
Student gets notification
        ↓
"Something's happening!"
        ↓
Open SAGE
        ↓
JOIN / PLAY / START
        ↓
Interactive activity
        ↓
Score / XP / progress
        ↓
Celebration
        ↓
Result / leaderboard
```

Gamification is **event-based**: the student should open SAGE and think
**"What's happening?"** — not "How much have I progressed?"

## Home screen hierarchy

The dashboard prioritizes, in order:

```text
WHAT'S HAPPENING?
        ↓
🎮 Live games
📚 New lessons
📝 Assigned activities
👥 Group activity
        ↓
YOUR PROGRESS (compact, secondary)
```

Progress (points, level, badges, history) still exists — it just must not
dominate the home screen. Keep it compact or on the profile.

## What NOT to emphasize

- 🔥 daily streaks
- ⭐ daily goals
- "come back tomorrow" nudges
- habit-building mechanics
- personal XP grinding as the primary loop
- endless self-serve learning paths on the home screen

Streaks and XP remain in the system as secondary signals (profile,
leaderboard, in-game feedback) — they are never the headline of the experience.

## Reference UX moments

> 🔔 **Your teacher started a Quiz Battle!**
>
> **Web Security — Section A**
>
> 12 players are waiting
> 🟢 Live
>
> **JOIN GAME →**

> 📚 **New lesson from your teacher**
>
> Authentication & Authorization
> 3 activities · ~20 min
>
> **START →**

> 🏆 **Your group challenge is ready**
>
> Can your team beat last week's score?
>
> **PLAY →**
