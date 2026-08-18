const TEAM_GROUPS = [
  ["Jordan", "Midland", "Spyker", "Force India", "Racing Point", "Aston Martin"],
  ["Minardi", "Toro Rosso", "AlphaTauri", "RB"],
  ["Toleman", "Benetton", "Renault", "Lotus F1 Team", "Alpine"],
  ["Tyrrell", "BAR", "Honda", "Brawn", "Mercedes"],
  ["Stewart", "Jaguar", "Red Bull"],
  ["Sauber", "BMW Sauber", "Alfa Romeo"],
  ["Arrows", "Footwork"],
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

function decadeOf(y) {
  return Math.floor(y / 10) * 10;
}

function compare(guess, answer) {
  const teamResult = guess.teams.map((t) => {
    if (answer.teams.includes(t)) return { name: t, state: "hit" };
    if (sameGroup(t, answer.teams)) return { name: t, state: "family" };
    return { name: t, state: "miss" };
  });

  const natHit = guess.nat === answer.nat;

  const gDec = decadeOf(guess.debut);
  const aDec = decadeOf(answer.debut);
  const decadeResult =
    gDec === aDec
      ? { state: "hit" }
      : { state: "miss", dir: aDec > gDec ? "up" : "down" };

  const titleResult =
    guess.titles === answer.titles
      ? { state: "hit" }
      : { state: "miss", dir: answer.titles > guess.titles ? "up" : "down" };

  return {
    teamResult,
    natHit,
    decadeResult,
    titleResult,
    correct: guess.name === answer.name
  };
}

module.exports = { TEAM_GROUPS, sameGroup, decadeOf, compare };
