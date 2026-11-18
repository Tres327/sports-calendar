"""Fetch team schedules from ESPN and build the site: one .ics feed per team plus data.json.

Usage: python build.py [output_dir]   (default: _site)
Standard library only, so it runs anywhere Python 3.9+ is installed.
"""

import json
import shutil
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).parent
ESPN = "https://site.api.espn.com/apis/site/v2/sports"
SEASON_TYPES = (2, 3)  # regular season, postseason (preseason is skipped)
GAME_LENGTH = {"football": timedelta(hours=3, minutes=30), "basketball": timedelta(hours=2, minutes=30)}
EMOJI = {"football": "\U0001F3C8", "basketball": "\U0001F3C0"}
LEAGUE_LABEL = {
    "nfl": "NFL",
    "nba": "NBA",
    "wnba": "WNBA",
    "college-football": "NCAA Football",
    "mens-college-basketball": "NCAA Men's Basketball",
}


def fetch(url, retries=3):
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "family-sports-calendar/1.0"})
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.load(resp)
        except Exception as exc:  # network hiccups, 5xx, bad JSON
            if attempt == retries - 1:
                raise RuntimeError(f"Failed to fetch {url}: {exc}") from exc
            time.sleep(2 * (attempt + 1))


def score_of(competitor):
    score = competitor.get("score")
    if isinstance(score, dict):
        return score.get("displayValue")
    return score


def rank_of(competitor):
    rank = (competitor.get("curatedRank") or {}).get("current")
    return rank if rank and rank <= 25 else None


def parse_event(event, team, sched):
    comp = event["competitions"][0]
    ours = next((c for c in comp["competitors"] if str(c["id"]) == str(sched["id"])), None)
    theirs = next((c for c in comp["competitors"] if c is not ours), None)
    if ours is None or theirs is None:
        return None
    status = comp["status"]["type"]
    opp = theirs["team"]
    logos = opp.get("logos") or [{}]
    venue = comp.get("venue") or {}
    address = venue.get("address") or {}
    link = next((l["href"] for l in event.get("links", []) if "desktop" in l.get("rel", [])), None)
    our_score, their_score = score_of(ours), score_of(theirs)
    final = status.get("completed") and our_score is not None
    result = None
    if final:
        if ours.get("winner"):
            result = "W"
        elif theirs.get("winner"):
            result = "L"
        else:
            result = "T"
    return {
        "id": event["id"],
        "team": team["key"],
        "sport": sched["sport"],
        "league": sched["league"],
        "leagueLabel": LEAGUE_LABEL.get(sched["league"], sched["league"]),
        "date": event["date"],
        "timeValid": bool(comp.get("timeValid", event.get("timeValid", True))),
        "seasonType": (event.get("seasonType") or {}).get("name"),
        "homeAway": ours.get("homeAway"),
        "neutral": bool(comp.get("neutralSite")),
        "opponent": opp.get("shortDisplayName") or opp.get("displayName"),
        "opponentFull": opp.get("displayName"),
        "opponentLogo": logos[0].get("href"),
        "ourRank": rank_of(ours),
        "oppRank": rank_of(theirs),
        "state": status.get("state"),  # pre / in / post
        "status": status.get("shortDetail") or status.get("description"),
        "statusName": status.get("name"),
        "ourScore": our_score if status.get("state") != "pre" else None,
        "oppScore": their_score if status.get("state") != "pre" else None,
        "result": result,
        "venue": venue.get("fullName"),
        "city": ", ".join(p for p in (address.get("city"), address.get("state")) if p),
        "tv": ", ".join(dict.fromkeys(b.get("media", {}).get("shortName") for b in comp.get("broadcasts", []) if b.get("media"))),
        "link": link,
    }


def team_games(team):
    games = {}
    logo = None
    for sched in team["schedules"]:
        base = f"{ESPN}/{sched['sport']}/{sched['league']}/teams/{sched['id']}/schedule"
        current = fetch(base)
        logo = logo or ((current.get("team") or {}).get("logo"))
        year = current["season"]["year"]
        # Previous season for history, next season in case its schedule is already out.
        for season in (year - 1, year, year + 1):
            for stype in SEASON_TYPES:
                data = fetch(f"{base}?season={season}&seasontype={stype}")
                for event in data.get("events", []):
                    game = parse_event(event, team, sched)
                    if game:
                        games[game["id"]] = game
    return sorted(games.values(), key=lambda g: g["date"]), logo


# ---------- iCalendar ----------

def ics_escape(text):
    return str(text).replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


def fold(line):
    """Fold to 75 octets per RFC 5545 without splitting UTF-8 characters."""
    out, current = [], b""
    for ch in line:
        b = ch.encode("utf-8")
        if len(current) + len(b) > (75 if not out else 74):
            out.append(current)
            current = b""
        current += b
    out.append(current)
    return "\r\n ".join(part.decode("utf-8") for part in out)


def matchup(team, g):
    us = f"#{g['ourRank']} {team['short']}" if g["ourRank"] else team["short"]
    them = f"#{g['oppRank']} {g['opponent']}" if g["oppRank"] else g["opponent"]
    sep = "@" if g["homeAway"] == "away" and not g["neutral"] else "vs"
    return f"{us} {sep} {them}"


def summary(team, g):
    text = f"{EMOJI[g['sport']]} {matchup(team, g)}"
    if g["result"]:
        text += f" \u00b7 {g['result']} {g['ourScore']}\u2013{g['oppScore']}"
    elif g["statusName"] in ("STATUS_POSTPONED", "STATUS_CANCELED", "STATUS_SUSPENDED"):
        text += f" ({g['status']})"
    return text


def description(g):
    lines = [g["leagueLabel"] + (f" \u00b7 {g['seasonType']}" if g["seasonType"] and g["seasonType"] != "Regular Season" else "")]
    if not g["timeValid"]:
        lines.append("Time TBD")
    if g["tv"]:
        lines.append(f"TV: {g['tv']}")
    if g["venue"]:
        lines.append(" \u2013 ".join(p for p in (g["venue"], g["city"]) if p))
    if g["link"]:
        lines.append(g["link"])
    return "\n".join(lines)


def build_ics(team, games, stamp):
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Family Sports Calendar//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        f"X-WR-CALNAME:{ics_escape(team['name'])}",
        f"X-WR-CALDESC:{ics_escape(team['name'] + ' schedule and results')}",
        f"COLOR:{team['color']}",
        "REFRESH-INTERVAL;VALUE=DURATION:PT3H",
        "X-PUBLISHED-TTL:PT3H",
    ]
    for g in games:
        start = datetime.strptime(g["date"], "%Y-%m-%dT%H:%MZ").replace(tzinfo=timezone.utc)
        lines += ["BEGIN:VEVENT", f"UID:espn-{g['id']}-{team['key']}@family-sports-calendar", f"DTSTAMP:{stamp}"]
        if g["timeValid"]:
            end = start + GAME_LENGTH[g["sport"]]
            lines += [f"DTSTART:{start:%Y%m%dT%H%M%SZ}", f"DTEND:{end:%Y%m%dT%H%M%SZ}"]
        else:
            # TBD games are stamped at midnight Eastern (04:00/05:00 UTC); shift back to get the US date.
            day = (start - timedelta(hours=4)).date()
            lines += [f"DTSTART;VALUE=DATE:{day:%Y%m%d}", f"DTEND;VALUE=DATE:{day + timedelta(days=1):%Y%m%d}"]
        lines += [
            f"SUMMARY:{ics_escape(summary(team, g))}",
            f"DESCRIPTION:{ics_escape(description(g))}",
        ]
        if g["venue"]:
            lines.append(f"LOCATION:{ics_escape(', '.join(p for p in (g['venue'], g['city']) if p))}")
        if g["link"]:
            lines.append(f"URL:{g['link']}")
        if g["statusName"] == "STATUS_CANCELED":
            lines.append("STATUS:CANCELLED")
        lines += ["TRANSP:TRANSPARENT", "END:VEVENT"]
    lines.append("END:VCALENDAR")
    return "\r\n".join(fold(l) for l in lines) + "\r\n"


def main():
    out = ROOT / (sys.argv[1] if len(sys.argv) > 1 else "_site")
    config = json.loads((ROOT / "teams.json").read_text(encoding="utf-8"))
    if out.exists():
        shutil.rmtree(out)
    shutil.copytree(ROOT / "web", out)
    (out / "feeds").mkdir()

    now = datetime.now(timezone.utc)
    stamp = now.strftime("%Y%m%dT%H%M%SZ")
    site = {"updated": now.isoformat(timespec="seconds"), "teams": [], "games": []}
    for team in config["teams"]:
        games, logo = team_games(team)
        feed = f"feeds/{team['key']}.ics"
        (out / feed).write_text(build_ics(team, games, stamp), encoding="utf-8", newline="")
        site["teams"].append({
            "key": team["key"], "name": team["name"], "short": team["short"], "color": team["color"],
            "logo": logo, "feed": feed,
            "leagues": [LEAGUE_LABEL[s["league"]] for s in team["schedules"]],
        })
        site["games"] += games
        print(f"{team['name']}: {len(games)} games -> {feed}")

    site["games"].sort(key=lambda g: g["date"])
    (out / "data.json").write_text(json.dumps(site, separators=(",", ":")), encoding="utf-8")


if __name__ == "__main__":
    main()
