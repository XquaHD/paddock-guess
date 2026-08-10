# Paddock Guess

A daily Formula 1 driver-guessing game (Wordle-style), with a small local
server so the answer never reaches your browser until you've finished —
and so your history of past days persists.

## Setup

You need [Node.js](https://nodejs.org) installed (any recent version, 18+).

```bash
cd paddock-guess-server
npm install
npm start
```

Then open **http://localhost:3000** in your browser.

Leave the terminal window open while you play — that's your server. To stop
it, press `Ctrl+C`. To run it again later, just repeat `npm start` from
inside the folder.

## How it works

- **Daily tab** — one driver per calendar day, same for every visit that
  day. The answer is chosen and stored on the server the first time you
  load the page each day, and is never sent to your browser until you've
  either guessed correctly or used all 8 guesses. Refreshing, closing the
  tab, or restarting the server won't reset today's puzzle or your guesses
  — they're saved in `data/db.json`.
- **Practice tab** — unlimited reroll rounds that never touch the server,
  for testing or casual play. "Easy" weights toward the ~65 most
  accomplished/well-known drivers (more starts, wins, points, titles =
  more likely); "Hard" picks with equal odds from the full 249-driver
  pool.
- **History tab** — every day since launch (2026-01-01), showing the
  puzzle number and result. The answer and guess count only show for days
  you've actually finished; an in-progress day shows your guess count but
  not the answer, and a day you haven't opened yet shows as "not played."

## Data

- `data/drivers.js` — the 249-driver roster (team history, nationality,
  debut decade, titles, career stats). Edit this if you spot an error or
  want to add/remove drivers — it's a plain JS array, no build step
  needed.
- `data/compare.js` — the team-lineage groups (e.g. Jordan → Force India →
  Aston Martin) and the guess-comparison logic, shared by the server.
- `data/db.json` — created automatically on first run. This is your saved
  game state. Delete it if you ever want to wipe history and start over.

## Notes

- This is built for a single player. If more than one person plays on the
  same running server, they'll share the same daily answer/history (there's
  no login system). Say the word if you'd like multi-player accounts added.
- To keep this running permanently (e.g. on a home server or small VPS)
  rather than starting it by hand each day, look into a process manager
  like `pm2` (`npm i -g pm2 && pm2 start server.js --name paddock-guess`)
  or a systemd service.
