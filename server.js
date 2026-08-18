const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { createClient } = require("@libsql/client");

const DRIVERS = require("./data/drivers.js");
const { compare } = require("./data/compare.js");

const PORT = process.env.PORT || 3000;
const MAX_GUESSES = 8;
const LAUNCH_DATE_STR = "2026-08-11"; // change this to today's date whenever you want puzzle #1 to start

// ---------- storage backend ----------
// Two modes, chosen automatically:
//   1. Turso (recommended for Render's free tier — no persistent disk
//      needed). Set TURSO_DATABASE_URL (and TURSO_AUTH_TOKEN if your
//      database requires one) as environment variables and this is used
//      automatically.
//   2. Local file (data/db.json). Used whenever TURSO_DATABASE_URL isn't
//      set — fine for local development, but wiped on every restart on
//      Render's free tier since free services can't attach persistent
//      disks. See README for a paid-disk alternative if you'd rather not
//      use Turso.
const USE_TURSO = !!process.env.TURSO_DATABASE_URL;
const DB_DIR = process.env.DB_DIR || path.join(__dirname, "data");
const DB_PATH = path.join(DB_DIR, "db.json");
const COOKIE_NAME = "pg_pid";

let turso = null;
if (USE_TURSO) {
  turso = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN
  });
}

const app = express();
app.set("trust proxy", 1);
app.use(express.json());

// ---------- tiny cookie-based anonymous session ----------
// No accounts, no passwords — just a random ID per browser so each
// visitor gets their own guesses/history instead of sharing one global
// attempt. The daily *answer* is still the same for everyone.

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  header.split(";").forEach((part) => {
    const idx = part.indexOf("=");
    if (idx === -1) return;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}

app.use((req, res, next) => {
  const cookies = parseCookies(req.headers.cookie);
  let pid = cookies[COOKIE_NAME];
  if (!pid) {
    pid = crypto.randomUUID();
    const oneYear = 365 * 24 * 60 * 60;
    const secureFlag = req.secure ? "; Secure" : "";
    res.setHeader(
      "Set-Cookie",
      `${COOKIE_NAME}=${pid}; Max-Age=${oneYear}; Path=/; HttpOnly; SameSite=Lax${secureFlag}`
    );
  }
  req.playerId = pid;
  next();
});

app.use(express.static(path.join(__dirname, "public")));

// ---------- "database" (Turso if configured, else a local JSON file) ----------

let tursoReady = null;
async function ensureTursoTable() {
  if (!tursoReady) {
    tursoReady = turso.execute(
      "CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT)"
    );
  }
  await tursoReady;
}

async function loadDB() {
  if (USE_TURSO) {
    await ensureTursoTable();
    const result = await turso.execute({
      sql: "SELECT value FROM kv WHERE key = ?",
      args: ["db"]
    });
    if (result.rows.length === 0) return { puzzles: {}, players: {} };
    try {
      const db = JSON.parse(result.rows[0].value);
      if (!db.puzzles) db.puzzles = {};
      if (!db.players) db.players = {};
      return db;
    } catch (e) {
      console.error("Could not parse stored data, starting fresh:", e.message);
      return { puzzles: {}, players: {} };
    }
  }

  if (!fs.existsSync(DB_PATH)) {
    return { puzzles: {}, players: {} };
  }
  try {
    const db = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
    if (!db.puzzles) db.puzzles = {};
    if (!db.players) db.players = {};
    return db;
  } catch (e) {
    console.error("Could not read db.json, starting fresh:", e.message);
    return { puzzles: {}, players: {} };
  }
}

async function saveDB(db) {
  if (USE_TURSO) {
    await ensureTursoTable();
    await turso.execute({
      sql: "INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      args: ["db", JSON.stringify(db)]
    });
    return;
  }

  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf8");
}

// ---------- date helpers ----------
// The "day" always means a UTC calendar day. This is deliberate and fixed:
// it doesn't depend on the server host's local timezone setting (which
// varies by hosting provider and isn't something we control), so the
// puzzle rolls over at the same real moment for every visitor everywhere:
// 00:00 UTC. Everything below uses UTC consistently to avoid the previous
// bug where date-string generation used local time but the day-count math
// used UTC, which could disagree about which day it was.

function toDateStr(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dateStrToNum(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return y * 10000 + m * 100 + d;
}

function puzzleNumberFor(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [ly, lm, ld] = LAUNCH_DATE_STR.split("-").map(Number);
  const diff = Math.floor(
    (Date.UTC(y, m - 1, d) - Date.UTC(ly, lm - 1, ld)) / 86400000
  );
  return Math.max(1, diff + 1);
}

function seededRandom(seed) {
  let a = seed | 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickDailyDriver(dateStr) {
  const rng = seededRandom(dateStrToNum(dateStr));
  const idx = Math.floor(rng() * DRIVERS.length);
  return DRIVERS[idx].name;
}

function findDriver(name) {
  return DRIVERS.find((d) => d.name === name);
}

// ---------- puzzle (shared answer) + per-player guesses ----------

async function getOrCreatePuzzle(db, dateStr) {
  if (!db.puzzles[dateStr]) {
    db.puzzles[dateStr] = {
      puzzleNumber: puzzleNumberFor(dateStr),
      driverName: pickDailyDriver(dateStr)
    };
    await saveDB(db);
  }
  return db.puzzles[dateStr];
}

function getPlayerGuesses(db, playerId, dateStr) {
  if (!db.players[playerId]) db.players[playerId] = {};
  if (!db.players[playerId][dateStr]) db.players[playerId][dateStr] = { guesses: [] };
  return db.players[playerId][dateStr];
}

function publicState(puzzle, playerEntry, dateStr) {
  const answerDriver = findDriver(puzzle.driverName);
  const guesses = playerEntry.guesses.map((name) => {
    const guessDriver = findDriver(name);
    return { guess: guessDriver, result: compare(guessDriver, answerDriver) };
  });
  const won = playerEntry.guesses.includes(puzzle.driverName);
  const completed = won || playerEntry.guesses.length >= MAX_GUESSES;
  return {
    date: dateStr,
    puzzleNumber: puzzle.puzzleNumber,
    maxGuesses: MAX_GUESSES,
    guesses,
    completed,
    won,
    answer: completed ? answerDriver : null
  };
}

// ---------- API ----------

app.get("/api/drivers", (req, res) => {
  res.json(DRIVERS);
});

// Visit this in a browser to see your own session ID. Load it on two
// different devices/browsers and compare — they should always differ.
app.get("/api/whoami", (req, res) => {
  res.json({ playerId: req.playerId });
});

app.get("/api/daily", async (req, res) => {
  const db = await loadDB();
  const dateStr = toDateStr(new Date());
  const puzzle = await getOrCreatePuzzle(db, dateStr);
  const playerEntry = getPlayerGuesses(db, req.playerId, dateStr);
  res.json(publicState(puzzle, playerEntry, dateStr));
});

app.post("/api/daily/guess", async (req, res) => {
  const db = await loadDB();
  const dateStr = toDateStr(new Date());
  const puzzle = await getOrCreatePuzzle(db, dateStr);
  const playerEntry = getPlayerGuesses(db, req.playerId, dateStr);

  const state = publicState(puzzle, playerEntry, dateStr);
  if (state.completed) {
    return res.status(400).json({ error: "Today's puzzle is already finished." });
  }

  const name = (req.body && req.body.name || "").trim();
  const driver = DRIVERS.find(
    (d) => d.name.toLowerCase() === name.toLowerCase()
  );
  if (!driver) {
    return res.status(400).json({ error: "Unknown driver name." });
  }
  if (playerEntry.guesses.includes(driver.name)) {
    return res.status(400).json({ error: "Already guessed that one." });
  }

  playerEntry.guesses.push(driver.name);
  await saveDB(db);

  res.json(publicState(puzzle, playerEntry, dateStr));
});

app.get("/api/history", async (req, res) => {
  const db = await loadDB();
  const todayStr = toDateStr(new Date());
  const [ly, lm, ld] = LAUNCH_DATE_STR.split("-").map(Number);
  const [ty, tm, td] = todayStr.split("-").map(Number);
  const startMs = Date.UTC(ly, lm - 1, ld);
  const endMs = Date.UTC(ty, tm - 1, td);

  const playerEntries = db.players[req.playerId] || {};
  const days = [];
  for (let t = endMs; t >= startMs; t -= 86400000) {
    const dateStr = toDateStr(new Date(t));
    const puzzle = db.puzzles[dateStr];
    const puzzleNumber = puzzleNumberFor(dateStr);
    const playerEntry = playerEntries[dateStr];

    if (!playerEntry || playerEntry.guesses.length === 0) {
      days.push({ date: dateStr, puzzleNumber, status: "unplayed", guessCount: 0 });
      continue;
    }

    const driverName = puzzle ? puzzle.driverName : pickDailyDriver(dateStr);
    const won = playerEntry.guesses.includes(driverName);
    const completed = won || playerEntry.guesses.length >= MAX_GUESSES;

    if (!completed) {
      days.push({ date: dateStr, puzzleNumber, status: "in-progress", guessCount: playerEntry.guesses.length });
    } else {
      days.push({
        date: dateStr,
        puzzleNumber,
        status: "completed",
        guessCount: playerEntry.guesses.length,
        won,
        answer: findDriver(driverName)
      });
    }
  }

  res.json({ launchDate: LAUNCH_DATE_STR, today: todayStr, days });
});

app.listen(PORT, () => {
  console.log(`Paddock Guess running on port ${PORT}`);
});
