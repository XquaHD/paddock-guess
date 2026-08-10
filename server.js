const express = require("express");
const fs = require("fs");
const path = require("path");

const DRIVERS = require("./data/drivers.js");
const { compare } = require("./data/compare.js");

const PORT = process.env.PORT || 3000;
const MAX_GUESSES = 8;
const LAUNCH_DATE_STR = "2026-01-01";
const DB_PATH = path.join(__dirname, "data", "db.json");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ---------- tiny JSON file "database" ----------

function loadDB() {
  if (!fs.existsSync(DB_PATH)) {
    return { puzzles: {} };
  }
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
  } catch (e) {
    console.error("Could not read db.json, starting fresh:", e.message);
    return { puzzles: {} };
  }
}

function saveDB(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf8");
}

// ---------- date helpers ----------

function toDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
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

// ---------- puzzle state ----------

function getOrCreatePuzzle(db, dateStr) {
  if (!db.puzzles[dateStr]) {
    db.puzzles[dateStr] = {
      puzzleNumber: puzzleNumberFor(dateStr),
      driverName: pickDailyDriver(dateStr),
      guesses: []
    };
    saveDB(db);
  }
  return db.puzzles[dateStr];
}

function publicState(puzzle, dateStr) {
  const answerDriver = findDriver(puzzle.driverName);
  const guesses = puzzle.guesses.map((name) => {
    const guessDriver = findDriver(name);
    return { guess: guessDriver, result: compare(guessDriver, answerDriver) };
  });
  const won = puzzle.guesses.includes(puzzle.driverName);
  const completed = won || puzzle.guesses.length >= MAX_GUESSES;
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

app.get("/api/daily", (req, res) => {
  const db = loadDB();
  const dateStr = toDateStr(new Date());
  const puzzle = getOrCreatePuzzle(db, dateStr);
  res.json(publicState(puzzle, dateStr));
});

app.post("/api/daily/guess", (req, res) => {
  const db = loadDB();
  const dateStr = toDateStr(new Date());
  const puzzle = getOrCreatePuzzle(db, dateStr);

  const state = publicState(puzzle, dateStr);
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
  if (puzzle.guesses.includes(driver.name)) {
    return res.status(400).json({ error: "Already guessed that one." });
  }

  puzzle.guesses.push(driver.name);
  saveDB(db);

  res.json(publicState(puzzle, dateStr));
});

app.get("/api/history", (req, res) => {
  const db = loadDB();
  const todayStr = toDateStr(new Date());
  const [ly, lm, ld] = LAUNCH_DATE_STR.split("-").map(Number);
  const start = new Date(ly, lm - 1, ld);
  const end = new Date();
  end.setHours(0, 0, 0, 0);
  start.setHours(0, 0, 0, 0);

  const days = [];
  for (let t = new Date(end); t >= start; t.setDate(t.getDate() - 1)) {
    const dateStr = toDateStr(t);
    const puzzle = db.puzzles[dateStr];
    const puzzleNumber = puzzleNumberFor(dateStr);

    if (!puzzle) {
      days.push({
        date: dateStr,
        puzzleNumber,
        status: "unplayed",
        guessCount: 0
      });
      continue;
    }

    const won = puzzle.guesses.includes(puzzle.driverName);
    const completed = won || puzzle.guesses.length >= MAX_GUESSES;

    if (!completed) {
      days.push({
        date: dateStr,
        puzzleNumber,
        status: "in-progress",
        guessCount: puzzle.guesses.length
      });
    } else {
      days.push({
        date: dateStr,
        puzzleNumber,
        status: "completed",
        guessCount: puzzle.guesses.length,
        won,
        answer: findDriver(puzzle.driverName)
      });
    }
  }

  res.json({ launchDate: LAUNCH_DATE_STR, today: todayStr, days });
});

app.listen(PORT, () => {
  console.log(`Paddock Guess running at http://localhost:${PORT}`);
});
