# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

IPL Madness 2K26 is a March Madness-style bracket prediction game for IPL 2026 cricket. Players submit match predictions, and the app auto-scores them as results come in via the CricketData.org API. Built with Node.js/Express + Firebase Firestore backend and vanilla JS frontend.

## Commands

```bash
npm install          # Install dependencies
npm start            # Run production server (node server.js)
npm run dev          # Run with auto-reload (nodemon)
npm run sync         # Manually trigger result sync from CricketData API
```

No test runner or linter is configured.

## Architecture

### Core Files

- **[server.js](server.js)** — Express server, all REST API routes, in-memory results cache (60s TTL), cron scheduler for auto-sync
- **[src/matches.js](src/matches.js)** — Game logic: `MATCHES[]` (20 league games), `scoreBracket()`, `maxPossible()`, `rankLeaderboard()`, `TEAM_NAME_MAP` for normalizing API team names
- **[api/sync-results.js](api/sync-results.js)** — Fetches results from CricketData API, updates Firestore `ipl2026/results`, triggers `recomputeLeaderboards()`
- **[public/index.html](public/index.html)** — Single-page frontend (bracket entry, group leaderboard, pick editing)
- **[public/admin.html](public/admin.html)** — Admin panel (group management, manual result overrides, force sync)

### Data Flow

1. Players submit bracket picks → `POST /api/picks` → stored in Firestore `groups/{groupId}/picks/{pickId}`
2. Cron job (every `SYNC_INTERVAL_MINUTES`) calls `syncResults()` in `api/sync-results.js`
3. `syncResults()` fetches CricketData API, matches results to local `MATCHES[]` by date + normalized team names, writes to `ipl2026/results`
4. `recomputeLeaderboards()` rescores all groups using `scoreBracket()` and updates leaderboard arrays in `groups/{groupId}`
5. Frontend polls `/api/results` and `/api/group/:id`

### Firestore Structure

```
ipl2026/results          # Singleton: { matches, semis, champion, finalRuns, lastSynced }
groups/{groupId}         # { id, name, locked, leaderboard[], memberCount, createdAt }
groups/{groupId}/picks/{pickId}  # { name, matches, semis, champion, submittedAt }
```

Pick IDs are deterministic: `${groupId}__${name_slug}` — this is how edits avoid duplicate entries.

### Scoring

| Prediction | Points |
|---|---|
| Correct league match winner (M1–M20) | 2 |
| Correct semifinalist | 5 |
| Correct champion | 10 |

Leaderboard uses dense ranking (same pts = same rank). Tiebreaker is total runs in the Final (stored as `finalRuns`).

## Environment Variables

Copy `.env.example` to `.env`:

| Variable | Purpose |
|---|---|
| `CRICKETDATA_API_KEY` | CricketData.org API key |
| `IPL_SERIES_ID` | Series ID from CricketData API |
| `FIREBASE_PROJECT_ID` | Firebase project ID |
| `FIREBASE_CLIENT_EMAIL` | Service account email |
| `FIREBASE_PRIVATE_KEY` | Service account private key (escape `\n`) |
| `ADMIN_PASSWORD` | Password for admin panel (`x-admin-password` header) |
| `SYNC_INTERVAL_MINUTES` | Auto-sync frequency (default: 30) |
| `PORT` | Server port (default: 3000) |

## Key Implementation Notes

- **Team name normalization**: CricketData API returns team names that differ from local names. `TEAM_NAME_MAP` in `src/matches.js` handles the mapping — update this if the API changes team name formats.
- **GitHub Actions sync**: `.github/workflows/sync-results.yml` hits `/api/admin/sync` on a 30-min cron. The workflow URL currently has a known double-`https://` bug on line 16.
- **Admin auth**: All `/api/admin/*` routes require `x-admin-password` header matching `ADMIN_PASSWORD` env var.
- **Bracket locking**: Groups can be locked by admin to prevent new submissions. Edits to existing picks are still allowed via `PUT /api/picks`.
- **All Firestore writes go through server** using Firebase Admin SDK — client-side rules deny all writes directly.
