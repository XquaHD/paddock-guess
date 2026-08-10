const MAX_GUESSES = 8;
const EASY_POOL_SIZE = 65;

let DRIVERS = [];
let EASY_POOL = [];

let dailyState = null;
let practiceState = { answer: null, guesses: [], difficulty: null, finished: false };

// ---------- shared comparison logic (mirrors server/data/compare.js) ----------

const TEAM_GROUPS = [
  ["Jordan", "Midland", "Spyker", "Force India", "Racing Point", "Aston Martin"],
  ["Minardi", "Toro Rosso", "AlphaTauri", "RB"],
  ["Toleman", "Benetton", "Renault", "Lotus F1 Team", "Alpine"],
  ["Tyrrell", "BAR", "Honda", "Brawn", "Mercedes"],
  ["Stewart", "Jaguar", "Red Bull"],
  ["Sauber", "BMW Sauber", "Alfa Romeo"],
  ["Arrows", "Footwork", "Shadow"],
  ["March", "Leyton House"],
  ["Osella", "Fondmetal"],
  ["Virgin", "Marussia", "Manor"]
];

function sameGroup(teamA, teamsB) {
  for (const g of TEAM_GROUPS) {
    if (g.includes(teamA)) {
      for (const tb of teamsB) {
        if (g.includes(tb) && tb !== teamA) return true;
      }
    }
  }
  return false;
}

function decadeOf(y) { return Math.floor(y / 10) * 10; }

// Strips accents/diacritics so "hulk" matches "Hülkenberg", "raikkonen"
// matches "Räikkönen", etc. — folds to plain a-z equivalents.
function foldText(s) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function compare(guess, answer) {
  const teamResult = guess.teams.map((t) => {
    if (answer.teams.includes(t)) return { name: t, state: "hit" };
    if (sameGroup(t, answer.teams)) return { name: t, state: "family" };
    return { name: t, state: "miss" };
  });
  const natHit = guess.nat === answer.nat;
  const gDec = decadeOf(guess.debut), aDec = decadeOf(answer.debut);
  const decadeResult = gDec === aDec
    ? { state: "hit" }
    : { state: "miss", dir: aDec > gDec ? "up" : "down" };
  const titleResult = guess.titles === answer.titles
    ? { state: "hit" }
    : { state: "miss", dir: answer.titles > guess.titles ? "up" : "down" };
  return { teamResult, natHit, decadeResult, titleResult, correct: guess.name === answer.name };
}

function resolveMatch(query, takenSet) {
  const q = foldText(query.trim());
  if (!q) return null;
  const exact = DRIVERS.find((d) => !takenSet.has(d.name) && foldText(d.name) === q);
  if (exact) return exact;
  const partial = DRIVERS.filter((d) => !takenSet.has(d.name) && foldText(d.name).includes(q));
  if (partial.length === 1) return partial[0];
  return null;
}

function fameWeight(d) {
  return 1 + d.starts * 0.4 + d.wins * 8 + d.points * 0.05 + d.titles * 25;
}

function weightedPick(pool) {
  const weights = pool.map(fameWeight);
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

// ---------- tabs ----------

document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    document.querySelectorAll(".panel").forEach((p) => (p.style.display = "none"));
    document.getElementById("panel-" + btn.dataset.tab).style.display = "block";
    if (btn.dataset.tab === "history") loadHistory();
  });
});

// ---------- generic autocomplete wiring ----------

function wireAutocomplete(inputId, suggestionsId, guessedNamesFn, onPick) {
  const input = document.getElementById(inputId);
  const suggestions = document.getElementById(suggestionsId);

  function update() {
    const q = foldText(input.value.trim());
    const taken = guessedNamesFn();
    suggestions.innerHTML = "";
    if (!q) { suggestions.classList.remove("open"); return; }
    const matches = DRIVERS.filter((d) => !taken.has(d.name) && foldText(d.name).includes(q)).slice(0, 8);
    if (matches.length === 0) { suggestions.classList.remove("open"); return; }
    matches.forEach((d) => {
      const div = document.createElement("div");
      div.className = "suggestion";
      div.innerHTML = `${d.flag} ${d.name}<small>${decadeOf(d.debut)}s</small>`;
      div.onclick = () => { input.value = d.name; suggestions.classList.remove("open"); onPick(); };
      suggestions.appendChild(div);
    });
    suggestions.classList.add("open");
  }

  input.addEventListener("input", update);
  input.addEventListener("focus", update);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); onPick(); }
    if (e.key === "Escape") suggestions.classList.remove("open");
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".guess-row")) suggestions.classList.remove("open");
  });
}

// ---------- rendering (shared shape) ----------

function renderRow(entry) {
  const { guess, result } = entry;
  const row = document.createElement("div");
  row.className = "row";

  const driverCell = document.createElement("div");
  driverCell.className = "cell driver";
  driverCell.innerHTML = `${guess.name}<span class="flag">${guess.flag} ${guess.nat}</span>`;

  const teamCell = document.createElement("div");
  teamCell.className = "cell";
  const chipWrap = document.createElement("div");
  chipWrap.className = "chip-wrap";
  result.teamResult.forEach((t) => {
    const chip = document.createElement("span");
    chip.className = "chip " + t.state;
    chip.textContent = t.name;
    chipWrap.appendChild(chip);
  });
  teamCell.appendChild(chipWrap);

  const natCell = document.createElement("div");
  natCell.className = "cell";
  const natBadge = document.createElement("div");
  natBadge.className = "single " + (result.natHit ? "hit" : "miss");
  natBadge.textContent = guess.flag + " " + guess.nat;
  natCell.appendChild(natBadge);

  const decCell = document.createElement("div");
  decCell.className = "cell";
  const decBadge = document.createElement("div");
  const dHit = result.decadeResult.state === "hit";
  decBadge.className = "single " + (dHit ? "hit" : "miss");
  decBadge.innerHTML = decadeOf(guess.debut) + "s " + (!dHit ? `<span class="arrow">${result.decadeResult.dir === "up" ? "▲" : "▼"}</span>` : "");
  decCell.appendChild(decBadge);

  const titCell = document.createElement("div");
  titCell.className = "cell";
  const titBadge = document.createElement("div");
  const tHit = result.titleResult.state === "hit";
  titBadge.className = "single " + (tHit ? "hit" : "miss");
  titBadge.innerHTML = guess.titles + " " + (!tHit ? `<span class="arrow">${result.titleResult.dir === "up" ? "▲" : "▼"}</span>` : "");
  titCell.appendChild(titBadge);

  row.appendChild(driverCell);
  row.appendChild(teamCell);
  row.appendChild(natCell);
  row.appendChild(decCell);
  row.appendChild(titCell);
  return row;
}

function renderTries(containerId, count) {
  const tries = document.getElementById(containerId);
  tries.innerHTML = "";
  for (let i = 0; i < MAX_GUESSES; i++) {
    const s = document.createElement("span");
    if (i < count) s.classList.add("used");
    tries.appendChild(s);
  }
}

// ---------- DAILY (server-backed) ----------

async function loadDaily() {
  const res = await fetch("/api/daily");
  dailyState = await res.json();
  renderDaily();
}

function renderDaily() {
  document.getElementById("rows").innerHTML = "";
  dailyState.guesses.forEach((g) => document.getElementById("rows").appendChild(renderRow(g)));
  document.getElementById("tryLabel").textContent = `Guess ${dailyState.guesses.length} / ${MAX_GUESSES}`;
  renderTries("tries", dailyState.guesses.length);
  document.getElementById("puzzleLabel").innerHTML = `<span class="dot"></span> Daily puzzle #${dailyState.puzzleNumber}`;

  const input = document.getElementById("guessInput");
  const btn = document.getElementById("guessBtn");
  const banner = document.getElementById("banner");
  const shareBtn = document.getElementById("shareBtn");

  if (dailyState.completed) {
    input.disabled = true;
    btn.disabled = true;
    banner.classList.add("show");
    shareBtn.style.display = "inline-block";
    if (dailyState.won) {
      banner.classList.add("win"); banner.classList.remove("lose");
      document.getElementById("bannerTitle").textContent = "Chequered flag";
      document.getElementById("bannerBody").innerHTML = `Got it in ${dailyState.guesses.length} guess${dailyState.guesses.length === 1 ? "" : "es"} — <span class="answer">${dailyState.answer.name}</span>.`;
    } else {
      banner.classList.add("lose"); banner.classList.remove("win");
      document.getElementById("bannerTitle").textContent = "Out of laps";
      document.getElementById("bannerBody").innerHTML = `The answer was <span class="answer">${dailyState.answer.name}</span>.`;
    }
  } else {
    input.disabled = false;
    btn.disabled = false;
    banner.classList.remove("show");
    shareBtn.style.display = "none";
  }
}

async function submitDailyGuess() {
  const input = document.getElementById("guessInput");
  const hint = document.getElementById("hint");
  const val = input.value.trim();
  if (!val) return;

  const taken = new Set(dailyState ? dailyState.guesses.map((g) => g.guess.name) : []);
  const resolved = resolveMatch(val, taken);
  if (!resolved) {
    const q = foldText(val);
    const anyMatch = DRIVERS.some((d) => !taken.has(d.name) && foldText(d.name).includes(q));
    hint.textContent = anyMatch
      ? "Multiple drivers match — keep typing or pick from the list."
      : "Not in the database — pick a name from the suggestions.";
    hint.classList.add("error");
    return;
  }

  const res = await fetch("/api/daily/guess", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: resolved.name })
  });
  const data = await res.json();

  if (!res.ok) {
    hint.textContent = data.error || "Something went wrong.";
    hint.classList.add("error");
    return;
  }

  hint.classList.remove("error");
  hint.textContent = "Teams, nationality, debut decade and titles are compared to the answer.";
  input.value = "";
  document.getElementById("suggestions").classList.remove("open");
  dailyState = data;
  renderDaily();
}

function buildDailyShareText() {
  const lines = dailyState.guesses.map((entry) => {
    const r = entry.result;
    const teamSq = r.teamResult.some((t) => t.state === "hit") ? "🟩" : "🟥";
    const natSq = r.natHit ? "🟩" : "🟥";
    const decSq = r.decadeResult.state === "hit" ? "🟩" : "🟥";
    const titSq = r.titleResult.state === "hit" ? "🟩" : "🟥";
    return `${teamSq}${natSq}${decSq}${titSq}`;
  });
  const result = dailyState.won ? `${dailyState.guesses.length}/${MAX_GUESSES}` : `X/${MAX_GUESSES}`;
  return `Paddock Guess #${dailyState.puzzleNumber} — ${result}\n` + lines.join("\n");
}

document.getElementById("guessBtn").onclick = submitDailyGuess;
wireAutocomplete("guessInput", "suggestions", () => new Set(dailyState ? dailyState.guesses.map((g) => g.guess.name) : []), submitDailyGuess);

document.getElementById("shareBtn").onclick = () => {
  const text = buildDailyShareText();
  copyToClipboard(text, document.getElementById("hint"));
};

// ---------- PRACTICE (client-side) ----------

function startPractice(diff) {
  const driver = diff === "easy" ? weightedPick(EASY_POOL) : DRIVERS[Math.floor(Math.random() * DRIVERS.length)];
  practiceState = { answer: driver, guesses: [], difficulty: diff, finished: false };
  renderPractice();
}

function renderPractice() {
  document.getElementById("practiceRows").innerHTML = "";
  practiceState.guesses.forEach((g) => document.getElementById("practiceRows").appendChild(renderRow(g)));
  document.getElementById("practiceTryLabel").textContent = `Guess ${practiceState.guesses.length} / ${MAX_GUESSES}`;
  renderTries("practiceTries", practiceState.guesses.length);

  const label = document.getElementById("practicePuzzleLabel");
  const easyBtn = document.getElementById("rerollEasyBtn");
  const hardBtn = document.getElementById("rerollHardBtn");
  easyBtn.classList.remove("active-diff");
  hardBtn.classList.remove("active-diff");

  if (practiceState.difficulty) {
    label.innerHTML = `<span class="dot" style="background:var(--amber)"></span> Practice — ${practiceState.difficulty}`;
    if (practiceState.difficulty === "easy") easyBtn.classList.add("active-diff");
    else hardBtn.classList.add("active-diff");
  } else {
    label.innerHTML = `<span class="dot" style="background:var(--amber)"></span> Practice`;
  }

  const input = document.getElementById("practiceInput");
  const btn = document.getElementById("practiceGuessBtn");
  const banner = document.getElementById("practiceBanner");

  if (!practiceState.answer) {
    input.disabled = true; btn.disabled = true;
    banner.classList.remove("show");
    return;
  }

  if (practiceState.finished) {
    input.disabled = true;
    btn.disabled = true;
    banner.classList.add("show");
    const last = practiceState.guesses[practiceState.guesses.length - 1];
    if (last.result.correct) {
      banner.classList.add("win"); banner.classList.remove("lose");
      document.getElementById("practiceBannerTitle").textContent = "Chequered flag";
      document.getElementById("practiceBannerBody").innerHTML = `Got it in ${practiceState.guesses.length} guess${practiceState.guesses.length === 1 ? "" : "es"} — <span class="answer">${practiceState.answer.name}</span>.`;
    } else {
      banner.classList.add("lose"); banner.classList.remove("win");
      document.getElementById("practiceBannerTitle").textContent = "Out of laps";
      document.getElementById("practiceBannerBody").innerHTML = `The answer was <span class="answer">${practiceState.answer.name}</span>.`;
    }
  } else {
    input.disabled = false;
    btn.disabled = false;
    banner.classList.remove("show");
  }
}

function submitPracticeGuess() {
  if (!practiceState.answer || practiceState.finished) return;
  const input = document.getElementById("practiceInput");
  const hint = document.getElementById("practiceHint");
  const val = input.value.trim().toLowerCase();
  if (!val) return;

  const taken = new Set(practiceState.guesses.map((g) => g.guess.name));
  const resolved = resolveMatch(val, taken);
  if (!resolved) {
    const q = foldText(val);
    const anyMatch = DRIVERS.some((d) => !taken.has(d.name) && foldText(d.name).includes(q));
    hint.textContent = anyMatch
      ? "Multiple drivers match — keep typing or pick from the list."
      : "Not in the database — pick a name from the suggestions.";
    hint.classList.add("error");
    return;
  }

  hint.classList.remove("error");
  hint.textContent = "Pick a difficulty below to start a round.";

  const result = compare(resolved, practiceState.answer);
  practiceState.guesses.push({ guess: resolved, result });
  input.value = "";
  document.getElementById("practiceSuggestions").classList.remove("open");

  if (result.correct || practiceState.guesses.length >= MAX_GUESSES) practiceState.finished = true;
  renderPractice();
}

document.getElementById("practiceGuessBtn").onclick = submitPracticeGuess;
wireAutocomplete("practiceInput", "practiceSuggestions", () => new Set(practiceState.guesses.map((g) => g.guess.name)), submitPracticeGuess);
document.getElementById("rerollEasyBtn").onclick = () => startPractice("easy");
document.getElementById("rerollHardBtn").onclick = () => startPractice("hard");

// ---------- HISTORY ----------

async function loadHistory() {
  const res = await fetch("/api/history");
  const data = await res.json();
  const list = document.getElementById("historyList");
  list.innerHTML = "";
  data.days.forEach((day) => {
    const row = document.createElement("div");
    row.className = "history-row";
    const numSpan = `<span class="hnum">#${day.puzzleNumber} · ${day.date}</span>`;
    let answerSpan, statusSpan;
    if (day.status === "completed") {
      answerSpan = `<span class="hanswer">${day.answer.name}</span>`;
      statusSpan = `<span class="hstatus ${day.won ? "won" : "lost"}">${day.won ? day.guessCount + "/" + MAX_GUESSES : "X/" + MAX_GUESSES}</span>`;
    } else if (day.status === "in-progress") {
      answerSpan = `<span class="hanswer" style="color:var(--muted);">In progress…</span>`;
      statusSpan = `<span class="hstatus progress">${day.guessCount}/${MAX_GUESSES}</span>`;
    } else {
      answerSpan = `<span class="hanswer" style="color:var(--muted);">Not played</span>`;
      statusSpan = `<span class="hstatus unplayed">—</span>`;
    }
    row.innerHTML = numSpan + answerSpan + statusSpan;
    list.appendChild(row);
  });
}

// ---------- clipboard helper ----------

function copyToClipboard(text, hintEl) {
  const done = () => { hintEl.classList.remove("error"); hintEl.textContent = "Result copied to clipboard."; };
  const fail = () => {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); done(); } catch (e) { hintEl.textContent = "Couldn't copy — select and copy manually."; }
    document.body.removeChild(ta);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(fail);
  } else { fail(); }
}

// ---------- boot ----------

async function boot() {
  const res = await fetch("/api/drivers");
  DRIVERS = await res.json();
  EASY_POOL = [...DRIVERS].sort((a, b) => fameWeight(b) - fameWeight(a)).slice(0, EASY_POOL_SIZE);
  await loadDaily();
}

boot();
