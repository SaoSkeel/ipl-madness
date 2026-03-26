# IPL Madness 2K26

A March Madness-style bracket prediction game for IPL 2026. Pick match winners, semifinalists, and the season champion — earn points as real results come in, and compete on a live group leaderboard.

---

## How It Works

Players submit a bracket before the tournament begins:
- Pick the winner of each of the **20 league stage matches**
- Pick the **top 4 semifinalists**
- Pick the **season champion**

Points are awarded automatically as IPL results come in, synced every 30 minutes from CricketData.org.

---

## Scoring

| Prediction | Points |
|---|---|
| Correct league match winner | 2 pts |
| Correct semifinalist (per team) | 5 pts |
| Correct season champion | 10 pts |
| Wrong pick | 0 — no deductions |

Maximum possible score: **60 pts** (40 league + 20 semis + 10 champion)

**Leaderboard** uses dense ranking — players with equal points share the same rank. Tiebreaker is closest predicted total runs in the Final.

---

## Features

**For players**
- Submit picks across multiple groups with one account
- Live scoring updates as matches complete
- See your current rank, points earned, and max points still achievable
- Expand each match to see correct/incorrect status in real time
- Edit your bracket any time before the group is locked

**Cross-device**
- Brackets are linked to your name + group code, not an account
- Load your bracket on any device by entering your name and group code on the Group tab

**Group leaderboard**
- Pre-lock: only your own picks are visible — everyone's score is shown but picks stay hidden until the admin locks the group
- Post-lock: full pick breakdown visible for all players
- Crown badge for 1st place once the champion is known

**Admin panel** (password-protected)
- Create groups and generate invite codes
- Lock groups to close submissions and reveal picks
- Manual result overrides to correct API errors
- Force sync to pull the latest results immediately
- Direct points override for individual brackets if needed

---

## Tech Stack

- **Backend:** Node.js · Express · Firebase Firestore (Admin SDK)
- **Frontend:** Vanilla JS · no frameworks
- **Live scoring:** CricketData.org API, synced every 30 min via in-process cron + GitHub Actions
- **Deployment:** Render
