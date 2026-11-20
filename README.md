# MeetingPoint

Find a fair place to meet when everyone starts from a different part of Jakarta. Times are calculated on real streets for each person's travel mode (car, motorbike, walking), and the meeting spot is always a real place of the kind you pick: cafe, mall, restaurant, coworking, park, or your own saved spots.

## How it works

1. You enter where each person starts and how they travel.
2. The app finds the middle of the group and loads matching places from OpenStreetMap around it.
3. It asks the routing engine for every person's trip time to about 40 evenly spread places, one request per travel mode.
4. It ranks them: **Fair for everyone** keeps the longest trip as short as possible; **Fastest overall** keeps the trips added together as short as possible.
5. It checks more places around the 3 best areas, then shows the top 3 with everyone's trip time and route.

Changing "Best spot is" or "Traffic" re-ranks instantly without new requests.

## Free services used (no API keys)

- **Map tiles:** OpenFreeMap (MapLibre). No key, no limits.
- **Routing:** Valhalla public server run by FOSSGIS (car = `auto`, motorbike = `motorcycle`, walk = `pedestrian`). Fair use, rate limited.
- **Places:** OpenStreetMap through the Overpass API (with two backup servers).
- **Search:** Photon by Komoot.

All calls go straight from the browser. Groups and saved spots are kept only in that browser's local storage.

## Limits to know

- **No live traffic.** Routing uses typical road speeds. The Traffic setting applies rough factors (Normal: car x1.4, motorbike x1.15; Rush hour: car x2, motorbike x1.35). Tune them in `lib/types.ts` (`TRAFFIC_FACTOR`).
- **Ganjil-genap** and other time-based road rules are not modelled.
- **Public transport** (KRL, MRT, TransJakarta) is not included yet.
- **Places** depend on OpenStreetMap coverage. Malls are well mapped in Jakarta, cafes partly. Use **My spots** to add places that are missing.
- The free servers ask for light use. That's fine for you and your friends; a public app should run its own routing server.

## Deploy

Needs Node.js 20+ and Git, plus free GitHub and Vercel accounts. No environment variables, no database.

```bash
npm install
git init
git add .
git commit -m "MeetingPoint v1"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/meetingpoint.git
git push -u origin main
```

Then in Vercel: Add New > Project > `meetingpoint` > Deploy.

`npm install` also copies MapLibre's worker file into `public/` (see `scripts/copy-worker.mjs`); Vercel does the same on every build.

## Fonts

Barlow, SIL Open Font License (`app/fonts/OFL.txt`).
