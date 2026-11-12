# Protocol

A personal, phone-first PWA for tracking progress in the Fortnite island **Star Wars Droid Tycoon**: rebirth requirements across the whole path, your base layout and income, what you need next and how to get it.

Fan project, not affiliated with the game's makers, Epic Games or Lucasfilm. No official names, logos or art are used in the app.

See [docs/DESIGN.md](docs/DESIGN.md) for the full design.

## Develop

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # engine + data tests
npm run build      # type-check + production build (dist/)
```

## Game data

Game data is compiled from the community sources players use, merged by majority vote:

- [Star Wars Droid Tycoon Fandom wiki](https://star-wars-droid-tycoon.fandom.com/) (CC BY-SA): rebirths, droid list and every droid's own page, fusions, Nova Shop, super rebirth payouts
- [droid-tycoon.pages.dev](https://droid-tycoon.pages.dev/), [tycoon-tools.com](https://tycoon-tools.com/) and [Droidex](https://droidex.web.app/): droid stats per tier, rebirth requirements, slot unlocks
- community charts (e.g. the chip station formula) and hand-written supplements

Where sources disagree the majority wins (ties go to the wiki), and every disagreement is listed in the app under Settings → Game data. The fan sites' JavaScript is **parsed, never executed** (`src/data/sources/literal.ts`), and only the extracted facts are stored.

```bash
npm run data       # pull everything, then build src/data/game-data.json
npm run data:build # rebuild from what's already on disk
```

- `data/raw/` — wiki page snapshots (wikitext + revision id); `data/raw/sources/` — facts extracted from the fan sites.
- `data/supplements/` — values the wiki lacks. **Edit these** to fill gaps:
  - `droids.json` — missing droids, Iconics, protocol droid bonuses, overrides.
  - `constants.json` — Hive Mind, chip costs, protocol slot unlocks, lounge, starting slots, etc.
  - `reset-rules.json` — what rebirth / super rebirth keep or wipe.
- `data/build-report.json` — warnings, disputes (supplement vs wiki) and overlaps (supplement values the wiki now has).

The build refuses to replace the current data if the result looks broken (too few droids or rebirth steps).

A nightly GitHub Action (`.github/workflows/game-data.yml`) pulls and rebuilds. Clean updates are committed to `main`; disputes or overlaps open a PR; three failed pulls in a row open an issue.

## Deploy

Static site: connect the repo to Cloudflare Pages with build command `npm run build` and output directory `dist`. Every push to `main` (including the nightly data commits) redeploys.
