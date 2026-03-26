# 🏏 IPL Madness 2K26 — Full Stack Setup Guide

A March-Madness-style bracket game for IPL 2026 with **live auto-scoring** via CricketData.org.

---

## Architecture

```
User Browser ←→ Express Server (Node.js) ←→ Firebase Firestore
                        ↓
               CricketData.org API (auto-sync every 30min)
```

---

## Step 1 — CricketData.org API Key (Free)

1. Go to **https://cricketdata.org/member.aspx** and create a free account
2. Copy your API key from the dashboard
3. To find the **IPL 2026 Series ID**, visit:
   ```
   https://api.cricapi.com/v1/series?apikey=YOUR_KEY&offset=0&search=Indian+Premier
   ```
   Look for `"Indian Premier League 2026"` and copy its `id` field.

---

## Step 2 — Firebase Setup

1. Go to **https://console.firebase.google.com** and create a new project
2. Enable **Firestore Database** (start in production mode)
3. Go to **Project Settings → Service Accounts → Generate new private key**
4. Download the JSON file and note the `project_id`, `client_email`, `private_key` fields
5. Enable **Firebase Hosting** (optional, for easy deployment):
   ```bash
   npm install -g firebase-tools
   firebase login
   firebase init hosting
   ```
6. In Firebase Console → **Project Settings → General → Your Apps**:
   - Add a **Web App**, copy the `firebaseConfig` object
   - Paste it into `public/index.html` (replace `FB_CONFIG = { ... }`)

### Firestore Security Rules
In Firebase Console → Firestore → Rules, paste:
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Anyone can read results and group leaderboards
    match /ipl2026/{doc} { allow read: if true; allow write: if false; }
    match /groups/{groupId} { allow read: if true; allow write: if false; }
    match /groups/{groupId}/picks/{pickId} { allow read: if false; allow write: if false; }
    // All writes go through your server (not direct from browser)
  }
}
```

---

## Step 3 — Configure Environment

```bash
cp .env.example .env
```

Edit `.env`:
```env
CRICKETDATA_API_KEY=your_key_from_step_1
IPL_SERIES_ID=your_series_id_from_step_1
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-...@project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_KEY\n-----END PRIVATE KEY-----\n"
ADMIN_PASSWORD=choose_a_strong_password
SYNC_INTERVAL_MINUTES=30
PORT=3000
```

---

## Step 4 — Install & Run

```bash
npm install
npm start          # production
npm run dev        # development (auto-reload)
```

Visit:
- **http://localhost:3000** — main app
- **http://localhost:3000/admin.html** — admin panel

---

## Step 5 — Create Your First Group

1. Open **http://localhost:3000/admin.html**
2. Enter your admin password
3. Under **Create Group**, enter a name (e.g. "The Cricket Lords") and code (e.g. "CL2026")
4. Share the group code with your friends

---

## Deployment Options

### Option A — Railway (easiest, free tier available)
```bash
# Install Railway CLI
npm install -g @railway/cli
railway login
railway init
railway up
```
Set environment variables in Railway dashboard under Variables.

### Option B — Render
1. Push to GitHub
2. Create new Web Service on render.com
3. Set environment variables
4. Deploy

### Option C — Heroku
```bash
heroku create your-ipl-madness
heroku config:set CRICKETDATA_API_KEY=...  # (set all env vars)
git push heroku main
```

### Option D — VPS (DigitalOcean/Linode)
```bash
# Install PM2 for process management
npm install -g pm2
pm2 start server.js --name ipl-madness
pm2 save
pm2 startup
# Use nginx as reverse proxy
```

---

## Scoring Logic

| Round | Points per correct pick |
|-------|------------------------|
| League Stage (M1–M20) | 10 pts |
| Qualifier 1 / Eliminator | 20 pts |
| Qualifier 2 | 40 pts |
| Top 4 Semifinalist (each) | 40 pts |
| IPL Champion | 160 pts |
| **Wrong pick** | **−(round pts) from Max Possible** |

**Tiebreaker:** Closest predicted total runs in the Final (both teams combined).

**Leaderboard sort:** Points earned → Max Possible → Tiebreaker closeness

---

## Admin Panel Features

- **Dashboard** — member count, results in, last sync time
- **Create Groups** — generate invite codes
- **Lock/Unlock** — close submissions before first match
- **Manual Overrides** — correct API errors or enter playoff results
- **Force Sync** — trigger immediate result fetch from CricketData API
- **Current State** — view raw results JSON stored in Firestore

---

## Auto-Sync Details

The server polls **CricketData.org** every `SYNC_INTERVAL_MINUTES` minutes (default: 30).

Free API tier: 100 hits/day recommended interval: 30–60 min
Paid API tier: can drop to 5–10 min

On each sync:
1. Fetches all series matches from `series_info` endpoint
2. Matches API results to local match list by date + team names
3. Extracts winner from `matchWinner` field or status string
4. Detects playoff matches (Qualifier/Eliminator/Final) by name
5. For Finals: fetches full scorecard to sum total runs (tiebreaker)
6. Writes results to Firestore `ipl2026/results`
7. Re-scores **all picks across all groups** and updates leaderboards

---

## File Structure

```
ipl-madness/
├── server.js              # Express API server + cron scheduler
├── src/
│   └── matches.js         # Match data + scoring engine
├── api/
│   └── sync-results.js    # CricketData.org fetcher + Firestore writer
├── public/
│   ├── index.html         # Main app (My Bracket + Group + Enter Picks)
│   └── admin.html         # Admin panel
├── package.json
├── .env.example
└── README.md
```
