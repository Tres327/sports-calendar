const EMOJI = { football: "\u{1F3C8}", basketball: "\u{1F3C0}" };
const DAY_MS = 86400000;

const state = {
  data: null,
  teams: {},
  hidden: new Set(load("hiddenTeams", [])),
  view: load("view", "upcoming"),
  month: null, // first day of the month shown in month view
};

function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

function esc(text) {
  return String(text ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// TBD games are stamped at midnight Eastern; treat them as date-only.
function gameDate(g) {
  const d = new Date(g.date);
  if (g.timeValid) return d;
  const et = new Date(d.getTime() - 4 * 3600000);
  return new Date(et.getUTCFullYear(), et.getUTCMonth(), et.getUTCDate());
}
function dayKey(d) { return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; }
function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }

const fmtTime = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const fmtDay = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" });
const fmtDayYear = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
const fmtMonth = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });

function matchup(g) {
  const team = state.teams[g.team];
  const us = g.ourRank ? `#${g.ourRank} ${team.short}` : team.short;
  const them = g.oppRank ? `#${g.oppRank} ${g.opponent}` : g.opponent;
  const sep = g.homeAway === "away" && !g.neutral ? "@" : "vs";
  return `${us} ${sep} ${them}`;
}

function sideHtml(g) {
  if (g.result) return `<span class="badge ${g.result}">${g.result}</span>${esc(g.ourScore)}–${esc(g.oppScore)}`;
  if (g.state === "in") return `<span class="live">LIVE</span> ${esc(g.ourScore)}–${esc(g.oppScore)}<div class="meta">${esc(g.status)}</div>`;
  if (g.state === "post") return `<span class="meta">${esc(g.status)}</span>`;
  const time = g.timeValid ? fmtTime.format(gameDate(g)) : "TBD";
  return `<div class="time">${time}</div><div class="meta">${esc(g.tv || "")}</div>`;
}

function gameRow(g) {
  const team = state.teams[g.team];
  const meta = [EMOJI[g.sport] + " " + g.leagueLabel, g.seasonType !== "Regular Season" ? g.seasonType : null, g.venue]
    .filter(Boolean).join(" · ");
  return `<button class="game" style="--team:${team.color}" data-id="${g.id}-${g.team}">
    <span class="bar"></span>
    <img src="${esc(g.opponentLogo)}" alt="" loading="lazy">
    <span class="main"><div class="title">${esc(matchup(g))}</div><div class="meta">${esc(meta)}</div></span>
    <span class="side">${sideHtml(g)}</span>
  </button>`;
}

function visibleGames() {
  return state.data.games.filter(g => !state.hidden.has(g.team));
}

function groupByDay(games, label) {
  let html = "", current = null;
  for (const g of games) {
    const key = dayKey(gameDate(g));
    if (key !== current) {
      if (current) html += "</div>";
      html += `<div class="day"><div class="day-label">${label(gameDate(g))}</div>`;
      current = key;
    }
    html += gameRow(g);
  }
  return current ? html + "</div>" : `<p class="empty">No games to show.</p>`;
}

function relativeDay(d) {
  const diff = Math.round((startOfDay(d) - startOfDay(new Date())) / DAY_MS);
  if (diff === 0) return "Today · " + fmtDay.format(d);
  if (diff === 1) return "Tomorrow · " + fmtDay.format(d);
  return diff < 7 ? fmtDay.format(d) : fmtDayYear.format(d);
}

function renderUpcoming() {
  const today = startOfDay(new Date());
  const games = visibleGames().filter(g => g.state === "in" || (g.state === "pre" && gameDate(g) >= today)).slice(0, 40);
  return `<h2>Upcoming</h2>` + groupByDay(games, relativeDay);
}

function renderResults() {
  const games = visibleGames().filter(g => g.state === "post").reverse().slice(0, 80);
  return `<h2>Results</h2>` + groupByDay(games, d => fmtDayYear.format(d));
}

function renderMonth() {
  const first = state.month;
  const gridStart = new Date(first.getFullYear(), first.getMonth(), 1 - first.getDay());
  const byDay = {};
  for (const g of visibleGames()) (byDay[dayKey(gameDate(g))] ??= []).push(g);
  const todayKey = dayKey(new Date());

  let cells = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(d => `<div class="dow">${d}</div>`).join("");
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
    if (i === 35 && d.getMonth() !== first.getMonth()) break; // skip an empty sixth week
    const key = dayKey(d);
    const pills = (byDay[key] || []).map(g => {
      const team = state.teams[g.team];
      const prefix = g.result ? `${g.result} ` : g.timeValid && g.state === "pre" ? fmtTime.format(gameDate(g)).replace(":00", "") + " " : "";
      return `<button class="pill" style="--team:${team.color}" data-id="${g.id}-${g.team}" title="${esc(matchup(g))}">${esc(prefix + matchup(g))}</button>`;
    }).join("");
    const cls = ["cell", d.getMonth() !== first.getMonth() ? "other" : "", key === todayKey ? "today" : ""].join(" ");
    cells += `<div class="${cls}"><div class="num">${d.getDate()}</div>${pills}</div>`;
  }
  return `<div class="month-head">
      <button class="btn" data-nav="-1" aria-label="Previous month">‹</button>
      <h2>${fmtMonth.format(first)}</h2>
      <span><button class="btn" data-nav="0">Today</button> <button class="btn" data-nav="1" aria-label="Next month">›</button></span>
    </div><div class="grid">${cells}</div>`;
}

function renderSubscribe() {
  const base = new URL(".", location.href);
  const rows = state.data.teams.map(t => {
    const url = new URL(t.feed, base).href;
    return `<div class="feed" style="--team:${t.color}">
      <img src="${esc(t.logo)}" alt="">
      <div class="info"><strong>${esc(t.name)}</strong> <span class="swatch"><i></i>${t.color}</span>
        <code>${esc(url)}</code></div>
      <button class="btn" data-copy="${esc(url)}">Copy link</button>
    </div>`;
  }).join("");
  return `<h2>Calendar feeds</h2>
    <div class="feeds">${rows}</div>
    <h2>Adding to Skylight</h2>
    <ol class="steps">
      <li>In the Skylight mobile app, go to your calendar sync settings and add a calendar by URL (iCal / ICS).</li>
      <li>Paste one team's link from above and save. Repeat for each team.</li>
      <li>Give each calendar the closest color to the team swatch shown here.</li>
      <li>Feeds rebuild every few hours; Skylight picks up new times and final scores on its own refresh schedule.</li>
    </ol>`;
}

function renderFilter() {
  document.getElementById("team-filter").innerHTML = state.data.teams.map(t =>
    `<button class="chip" style="--team:${t.color}" data-team="${t.key}" aria-pressed="${!state.hidden.has(t.key)}">
      <img src="${esc(t.logo)}" alt="">${esc(t.short)}</button>`).join("");
}

function render() {
  document.querySelectorAll(".tabs button").forEach(b => b.setAttribute("aria-selected", b.dataset.view === state.view));
  document.getElementById("team-filter").hidden = state.view === "subscribe";
  const view = { upcoming: renderUpcoming, month: renderMonth, results: renderResults, subscribe: renderSubscribe }[state.view];
  document.getElementById("view").innerHTML = view();
}

function showGame(id) {
  const g = state.data.games.find(x => `${x.id}-${x.team}` === id);
  if (!g) return;
  const team = state.teams[g.team];
  const when = g.timeValid ? `${fmtDayYear.format(gameDate(g))}, ${fmtTime.format(gameDate(g))}` : `${fmtDayYear.format(gameDate(g))} (time TBD)`;
  const rows = [
    ["Status", g.result ? `${g.result} ${g.ourScore}–${g.oppScore}` : g.status],
    ["When", when],
    ["League", g.leagueLabel + (g.seasonType !== "Regular Season" ? ` · ${g.seasonType}` : "")],
    ["TV", g.tv],
    ["Venue", [g.venue, g.city].filter(Boolean).join(", ")],
  ].filter(([, v]) => v);
  document.getElementById("game-detail").innerHTML = `<div class="detail">
    <div class="detail-head" style="--team:${team.color}"><img src="${esc(g.opponentLogo)}" alt="">
      <div><h3>${EMOJI[g.sport]} ${esc(matchup(g))}</h3><div class="meta">${esc(g.opponentFull)}</div></div></div>
    <dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
    ${g.link ? `<p><a href="${esc(g.link)}" target="_blank" rel="noopener">Open on ESPN ↗</a></p>` : ""}
  </div>`;
  document.getElementById("game-dialog").showModal();
}

document.addEventListener("click", e => {
  const tab = e.target.closest(".tabs button");
  if (tab) { state.view = tab.dataset.view; save("view", state.view); render(); return; }

  const chip = e.target.closest(".chip");
  if (chip) {
    const key = chip.dataset.team;
    state.hidden.has(key) ? state.hidden.delete(key) : state.hidden.add(key);
    save("hiddenTeams", [...state.hidden]);
    renderFilter(); render(); return;
  }

  const nav = e.target.closest("[data-nav]");
  if (nav) {
    const step = Number(nav.dataset.nav), m = state.month;
    state.month = step === 0 ? new Date(new Date().getFullYear(), new Date().getMonth(), 1) : new Date(m.getFullYear(), m.getMonth() + step, 1);
    render(); return;
  }

  const copy = e.target.closest("[data-copy]");
  if (copy) {
    navigator.clipboard?.writeText(copy.dataset.copy).then(() => {
      copy.textContent = "Copied";
      setTimeout(() => (copy.textContent = "Copy link"), 1500);
    });
    return;
  }

  const game = e.target.closest("[data-id]");
  if (game) showGame(game.dataset.id);
});

async function init() {
  const now = new Date();
  state.month = new Date(now.getFullYear(), now.getMonth(), 1);
  try {
    const res = await fetch("data.json", { cache: "no-cache" });
    state.data = await res.json();
  } catch {
    document.getElementById("view").innerHTML = `<p class="empty">Couldn't load schedule data.</p>`;
    return;
  }
  for (const t of state.data.teams) state.teams[t.key] = t;
  document.getElementById("updated").textContent =
    "Updated " + new Date(state.data.updated).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  renderFilter();
  render();
}

init();
