# Protocol — Design

> Working name. A personal tracker/helper PWA for the Fortnite (UEFN) island **Star Wars Droid Tycoon** (game v1.38.5 at time of writing, 2026-11-11).
> Combines tycoon-tools.com's collection tracking with droidtycoonhelper.com's base/resource management, and fixes gaps in both.
> No Star Wars / Fortnite / Lucasfilm / Epic names, logos or art in the app. No droid images.

## 1. Goals

- **Personal first, shareable later.** Nothing in the design should block a public release (rename, sync, polish).
- **One source of truth.** A single inventory feeds every view (rebirths, base, collection, fusion, chips, planner).
- **Accurate to *your* game.** Community formulas are calibrated against numbers you enter from the game.
- **Never block the player.** Gates are soft confirms, every action has undo, rebirth number is always directly editable.

## 2. Stack & hosting

| Concern | Choice |
|---|---|
| App | Vite + React + TypeScript SPA |
| Styling | Tailwind |
| Storage | Dexie (IndexedDB), behind a storage interface so cloud sync can be added later |
| PWA | vite-plugin-pwa (offline, installable) |
| Repo | Public GitHub repo |
| Hosting | Cloudflare Pages (static) |
| Tests | Unit tests on all calculation modules, using fixture saves built from the real game state. Calc logic lives in a pure module separate from UI. |

Persistence v1: local only + JSON export/import. v2: optional cloud sync (and with it, push notifications).

## 3. Game data pipeline

- **Primary source:** Fandom wiki MediaWiki API (`star-wars-droid-tycoon.fandom.com/api.php`, CC-BY-SA). Data is in hand-written wikitext tables → scrape & parse.
- **Supplements:** hand-maintained file in the repo for what the wiki lacks (protocol slot unlocks, chip costs, Hive Mind constants, rebirth 35–40 unlocks, reset rules, etc.). User fills these in over time.
- **Not used:** datamined sources (dev FOAD asked fan sites not to republish datamines); other fan sites' data without permission.
- **Provenance:** every value carries source + date (+ game version where known). Disputed values show a "?" with all sources.
- **Nightly GitHub Action (build time, not runtime):**
  - Identifies itself clearly, rate-limits politely (wiki has returned HTTP 402 to automated clients at times).
  - Clean update → commit straight to main → redeploy.
  - Conflict between sources, supplement now overlapping wiki data, or 3 consecutive failed pulls → open a PR/issue.
  - Failed/partial pulls never replace the last good dataset.
- **In-app:** "Game data updated to <date>" banner with a short changelog; Settings badge "N data issues need you" linking to open PRs/issues (public GitHub API, no auth); "Data as of <date>, game v<x>" shown in Settings.
- **Reset rules** (what rebirth / super rebirth keep or wipe) are data, not code.

## 4. Domain model (key facts)

- **Tiers (9):** Default, Gold, Diamond, Rainbow, Beskar, Galactic, Stellar, Kyber, Scourge. Higher tier satisfies lower. **Scourge satisfies any tier** requirement (incl. Kyber).
- **Kyber** must be activated at the Cantina to count; colours Green ×3, Blue ×3.25, Purple ×3.6.
- **Flawless ★**: variant flag; +0.01 multiplier per unique Flawless.
- **Classes/areas:** Worker, Astromech, Battle, Protocol; plus Lounge (counts for requirements, earns nothing), companions, chip stations.
- **Rarities:** Common, Rare, Epic, Legendary, Mythic, Iconic (Iconics boost others, have no tiers, can't be chip-upgraded).
- **Paths:** 6 paths × 40 rebirths. Each rebirth = 3 named droids at min tier + credits. Required droids are **not consumed**; must be in base or Lounge.
- **Fusion:** 3 identical → next tier; 3 different same-rarity → random droid one rarity up. Since v1.38 **fusion droids count for their components' requirements**. Unlocks at rebirth 3.
- **Protocol slots (6):** Worker credits R2, Astromech credits R6, Battle credits R10, Worker crafting R14, Astromech crafting R18, Battle crafting R22. Unlocked by rebirth, not Nova. Scourge Prime (Iconic Protocol) can sit in one.
- **Lounge capacity:** 5 base + 1 each at R17–20 + up to 12 Nova slots (max 21).
- **Hive Mind** (single datamine-derived source → constants editable in settings): each placed Scourge earns +10.45% of its own income per *other* placed Scourge; Scourge Prime adds 5 effective members. Counts work/mission/battle/protocol/chip-station placements, not Lounge/companions.
- **Chip stations:** produce chips at 2 × rarity rank × tier rank / min; storage 1 h (Nova capacity up to 6 h); Station 2 = Nova upgrade (1,200). Chips buy tier upgrades instantly (cost tables per rarity). Can't make Scourge; upgrading removes Flawless.
- **Income formula (community-derived):** `tier income × 1.1 (class match) × global multiplier × (1 + protocol area bonus)`; Iconics earn a % of summed raw income. Global multiplier taken from user input (in-game green number), not computed.
- **Rebirth:** credits → 0, rebirth +1, droids kept, slot unlocks applied.
- **Super rebirth:** needs rebirth ≥12 + a Legendary Rainbow+ droid in base. Moves to next path at rebirth 0, adds Nova Crystals.
  - Wiped: droids, credits, chips, blueprints, Kyber activation, companions, Lounge contents, non-Iconic traits, base upgrades/benches.
  - Kept: Nova Crystals, Nova Shop upgrades (incl. Nova lounge slots, chip station unlocks), Droidex progress, Flawless unlocks, Iconic unlocks + Iconic traits, permanent boost.
  - Iconics reclaimable for **1M credits** each.
- **Scourge availability:** only Scourge Fridays (from 03:00 UTC, 24 h) and some events.

## 5. Data held per user

- **Profile:** path, current rebirth, lifetime rebirths (setup input, auto-incremented), super rebirths (optional pre-tracking count + tracked count), in-game multiplier, calibration samples, Nova Shop levels, bench/craft-speed levels, chip station count/capacity, Hyperdrive flag, CB-23 mission length & speed %.
- **Inventory:** droids (droid id, tier, Flawless, Kyber colour/activated, location = area slot | protocol slot | Lounge | chip station | storage), blueprints owned, crafting in progress (+ optional timer), Iconic reclaim status.
- **Logs:** rebirth/super rebirth history (for undo + stats), CB-23 mission results.

## 6. First-run setup (re-runnable from Settings)

1. Path + current rebirth (+ lifetime rebirths, optional super rebirth count)
2. Nova Shop purchases (checklist with levels, from wiki Nova Shop page)
3. In-game multiplier
4. Bench / craft-speed levels
5. Droids, area by area on the base screen

Protocol slots and lounge capacity are derived automatically; user confirms/overrides.

## 7. v1 features

1. **Rebirth view** — full-path readiness list (every remaining rebirth: Ready / Missing N, far-ahead satisfiable rebirths highlighted; no target setting; super-rebirth point is a marker). **"Needed by" queue**: missing droids sorted by ETA (from calibrated income). Each requirement lists coverage options: own it · chip upgrade (chip ETA) · fuse (e.g. "2 of 3 Gold R9") · fusion droid containing it · craft (craft time with speed bonuses) · spare Scourge · needs luck.
2. **Base screen (primary editor)** — tap slot → quick sheet (tier ±, Flawless, Kyber colour, move to, swap, remove); drag-drop on desktop, tap-tap swap on mobile; undo toast. All 6 protocol slots, Lounge up to 21. Best-layout solver (Hive Mind + Prime aware, keeps needed droids). Credits/sec + time to next rebirth.
3. **Collection grid** — search-as-you-type, highest tier owned with one-tap tier ±, "needed soon" badges, group by class, shows current location.
4. **Calibration** — enter in-game multiplier + occasional actual credits/sec → correction factor applied to all ETAs.
5. **Scourge tools** — solver integration; "what if N more Scourge" slider + break-even vs best regular build; spare-Scourge requirement hints; super-rebirth warning ("lose N Scourge ≈ X% income; next Scourge Friday in …") with Friday-aware timing tip; Scourgedex hand-in warning if an upcoming rebirth needs that droid.
6. **Chip stations** — chip rate for station 1/2, best droid to place (chip rate vs credits vs Hive Mind), "full in X" countdown, chip ETAs in the needed-by queue.
7. **Fusion helper** — integrated into requirement coverage; flags easy fusions available now and surplus droids worth fusing.
8. **Super rebirth planner** — per stopping point (now, +1 … 40): crystals gained, time to afford credits, coverage breakdown (owned / chip-able / fusable / craftable / Scourge / needs luck), best crystals-per-hour point excluding luck; luck-dependent points shown as stretch targets. Eligibility shown, never enforced.
9. **Rebirth / super rebirth buttons** — apply reset rules from data, toasts for unlocks, Iconics marked reclaimable (1M each), undo, soft confirm when not eligible, rebirth number directly editable.
10. **Timers** — events and blueprint schedules (Scourge Friday, Boosted Weekend, World Missions, hourly blueprints), in-app only.
11. **CB-23 mission log** — buttons Chips / Crystals 40 / Crystals 80 (×3 when Hyperdrive on); stores time, rebirth, game version; user-set mission length (default 20 min) with suggestion from log gaps; optional mission speed %; soft gate ("Log anyway?"); stats: crystal rate vs community ~10%, crystals/day, chips/hour.

## 8. Look & feel

- Modern dark, phone-first layout, good on a desktop second screen.
- Retro-terminal accents (monospace readouts, amber/green panels, subtle scanlines, bracket frames) with a **Clean ↔ Terminal** intensity toggle.
- **Tier colours** always paired with the tier name, contrast-checked in both modes, never tinted by effects: Default grey, Gold amber, Diamond ice-blue, Rainbow gradient, Beskar steel, Galactic violet, Stellar white-gold, Kyber crystal colour, **Scourge near-black deep purple with toxic-red outline/glow**.
- Droids as text cards: tier chip, class glyph, rarity border, ★ for Flawless.

## 9. Out of scope for v1

Background/push notifications, cloud sync, trading, traits & trait locks, Scourgedex tracking, companion management, crafting-time effects of crafting protocol slots, localisation, approaching droidtycoonhelper's author for data.

## 10. Known unknowns (verify in game / fill supplements)

- Protocol slot unlock rebirths (one source says R2/6/10/14/18/22; another only R22).
- All Hive Mind constants (single datamine-derived source).
- Scourge chip-station rate; Scourge Prime shop price.
- CB-23 mission length (sources: 18 / 20 / 50 min) and any mission-speed perk.
- Blueprint / crate tier odds (unpublished → "needs luck").
- Small income disagreements between sources (e.g. Gonk Stellar 126 vs 128).

## 11. Reference sources

- Wiki: https://star-wars-droid-tycoon.fandom.com/
- droidtycoonhelper.com (reference for features; data © its author)
- tycoon-tools.com (reference for features; stale on Scourge)
- github.com/jrlee2x/droid-advisor (MIT, v1.37 JSON) — possible cross-check
