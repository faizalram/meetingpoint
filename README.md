# MeetingPoint

Find a fair place to meet when everyone starts from a different part of Jakarta. Each person picks how they travel (car, motorbike, walking). The app finds real places of the kind you choose (cafe, mall, restaurant, coworking, park, or your own spots) and compares everyone's trip times with TomTom's live traffic.

## How it works

1. Enter where each person starts (TomTom place search, pick on the map, or your location) and how they travel.
2. The app finds the middle of the group and asks TomTom for matching spots around it (7 searches spread over the area).
3. It gets everyone's trip time to 16 well spread spots in one TomTom Batch Routing request per travel mode: car and motorbike with live traffic, walking.
4. **Fair for everyone** keeps the longest trip as short as possible; **Fastest overall** keeps the trips added together as short as possible.
5. It checks 4 more spots around each of the 3 best areas, then shows the top 3 with everyone's time and route.

Motorbike uses TomTom's `motorcycle` travel mode, which TomTom marks as beta: restriction data isn't complete everywhere. Coworking spaces are found by keyword, since TomTom has no coworking category.

## TomTom setup (free, no credit card)

1. Sign up at my.tomtom.com (or developer.tomtom.com > Sign up).
2. Keys > API & SDK Keys > Create Key, twice:
   - `meetingpoint-server` with **Search API** and **Routing API** (Batch Routing is part of Routing)
   - `meetingpoint-map` with **Map Display API**
3. Copy both keys. Don't set allowed domains: both are only used by this app's server.

The free plan gives 2,500 non-tile requests and 50,000 map tiles a day. Without prepaid credit, requests past the daily amount are blocked, not billed, so the app can't cost you money.

## Vercel environment variables

| Name | Value |
|---|---|
| `TOMTOM_API_KEY` | Server key |
| `TOMTOM_MAP_KEY` | Map key |

Redeploy after adding them. Both keys stay on the server: place search, trip times and routes use `TOMTOM_API_KEY`, and map tiles go through the app's `/api/tile` route with `TOMTOM_MAP_KEY`, so the browser never sees either key.

## Daily usage

One search for 3 people and one kind of place uses about 7 spot searches, about 84 route calculations (28 spots × 3 people) and 3 route lines, so roughly 100 requests. That's about 25 searches a day on the free plan. Map tiles are counted separately (50,000 a day), and tiles you've already seen are served from the browser and Vercel's cache for a day.

If the daily amount runs out, the app says so; it resets the next day.

## Privacy and data

- Groups and saved spots stay in your browser (local storage).
- Place searches, trip times, routes and map tiles go through this app's own server routes, so neither TomTom key reaches the browser. The routes only accept requests from the app's own pages.

## Local development

```bash
npm install
cp .env.example .env.local   # fill in both keys
npm run dev
```

`npm install` also copies MapLibre's worker file into `public/` (see `scripts/copy-worker.mjs`); Vercel does the same on every build.

## Fonts

Barlow, SIL Open Font License (`app/fonts/OFL.txt`).
