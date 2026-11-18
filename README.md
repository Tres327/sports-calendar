# Family Sports Calendar

Schedules and results for our teams, pulled from ESPN's public (unofficial) API and published as:

- a web page with upcoming games, a month view, and results
- one `.ics` calendar feed per team, for subscribing in Skylight (or Google/Apple/Outlook)

| Team | League(s) | Color | Feed |
|---|---|---|---|
| Jacksonville Jaguars | NFL | `#006778` teal | `feeds/jaguars.ics` |
| Miami Heat | NBA | `#98002E` red | `feeds/heat.ics` |
| Dallas Mavericks | NBA | `#00538C` blue | `feeds/mavericks.ics` |
| Florida Gators | NCAA Football + Men's Basketball | `#FA4616` orange | `feeds/gators.ics` |
| Clemson Tigers | NCAA Football + Men's Basketball | `#522D80` purple | `feeds/clemson.ics` |
| Indiana Fever | WNBA | `#002D62` blue | `feeds/fever.ics` |

Feeds include last season, the current season, and next season once ESPN publishes it (regular season + postseason).
Finished games show the result in the title, e.g. `🏈 Jaguars vs Bills · W 27–24`. Games without a set time appear as all-day events.

## How it works

- `teams.json` — the teams, their ESPN IDs, and colors
- `build.py` — fetches schedules and writes `_site/` (web page, `data.json`, `feeds/*.ics`). Standard library only.
- `web/` — the page source (HTML/CSS/JS, no build step)
- `.github/workflows/update.yml` — rebuilds and deploys to GitHub Pages every 2 hours, on every push, and on demand

## One-time GitHub setup

1. Push this folder to a **public** GitHub repo (free GitHub Pages requires public).
2. Repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. **Actions** tab → *Update calendar* → **Run workflow** (or just push).
4. The site is at `https://<username>.github.io/<repo>/`; feed links are on its **Subscribe** tab.

## Adding to Skylight

In the Skylight mobile app, add each feed URL as a subscribed (iCal/ICS) calendar, then give it the closest color to the team's.
Skylight refreshes subscribed calendars on its own schedule, so new times and final scores can lag the web page.

## Adding or changing a team

Find the team's ESPN ID at `https://site.api.espn.com/apis/site/v2/sports/{sport}/{league}/teams`
(e.g. `football/nfl`, `basketball/nba`, `basketball/wnba`, `football/college-football`, `basketball/mens-college-basketball`),
add an entry to `teams.json`, and push.

## Running locally

```
python build.py
python -m http.server 8000 --directory _site
```
