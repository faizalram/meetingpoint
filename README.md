# MeetingPoint

Find a fair place to meet when everyone starts from a different part of Jakarta. Each person picks how they travel (car, motorbike, walking). The app finds real places of the kind you choose (cafe, mall, restaurant, coworking, park, or your own spots) and compares everyone's trip times with Google's live or predicted traffic.

## How it works

1. Enter where each person starts (Google place search, pick on the map, or your location) and how they travel.
2. The app finds the middle of the group and asks Google Places for matching spots around it (7 searches spread over the area).
3. It gets everyone's trip time to 16 well spread spots with one Google Routes "route matrix" call per travel mode: car with live traffic, motorbike with Google's two-wheeler routing, walking.
4. **Fair for everyone** keeps the longest trip as short as possible; **Fastest overall** keeps the trips added together as short as possible.
5. It checks 4 more spots around each of the 3 best areas, then shows the top 3 with everyone's time and route.

Switching Fair / Fastest re-ranks instantly. Changing people, travel modes, spot types or the departure time needs a new search.

## Google Cloud setup (once)

1. Go to console.cloud.google.com, create a project called `meetingpoint`, and link a billing account (a card is required; usage within Google's free monthly amounts costs nothing).
2. APIs & Services > Library: enable **Maps JavaScript API**, **Places API (New)** and **Routes API**.
3. APIs & Services > Credentials > Create credentials > API key, twice:
   - **Server key**: API restrictions = Places API (New) + Routes API. No application restriction (Vercel's servers have changing addresses). This one is secret.
   - **Browser key**: Application restrictions = Websites, add `https://YOUR-PROJECT.vercel.app/*`. API restrictions = Maps JavaScript API.
4. Optional: Google Maps Platform > Map Management > Create Map ID (JavaScript, Vector). Without it the app uses Google's `DEMO_MAP_ID`, which is fine for personal use.
5. Recommended: Billing > Budgets & alerts, set a small monthly budget (e.g. USD 5) with email alerts. You can also lower daily quotas for Routes API and Places API (New) under APIs & Services > (API) > Quotas.

## Vercel environment variables

| Name | Value |
|---|---|
| `GOOGLE_MAPS_API_KEY` | Server key |
| `GOOGLE_MAPS_BROWSER_KEY` | Browser key |
| `GOOGLE_MAP_ID` | Map ID (optional) |

Redeploy after adding or changing them. The server key never leaves the server. The browser key is handed to the page at runtime by `/api/config`, because Google's map script must load with it; that's why it's restricted to your website.

## What it uses per search (3 people, one spot type)

- Places Nearby Search: 7 calls
- Route matrix: about 28 spots × each person, split by travel mode (car = Pro with traffic, motorbike = Enterprise, walking = Essentials)
- Routes for the option you view: 1 call per person
- Start point search: typing is free within a session; picking a place is 1 Place Details (Essentials) call

Google gives free monthly amounts per SKU (10,000 Essentials, 5,000 Pro, 1,000 Enterprise). For a small group that's roughly 30 to 90 free searches a month, depending on how many people go by motorbike (the Enterprise bucket is smallest). Past that, a search costs on the order of USD 1, mostly trip times. The budget alert above tells you before that happens.

## Privacy and data

- Groups and saved spots stay in your browser (local storage).
- API calls for places and trips go through this app's own server routes, so the server key is never sent to the browser. The routes only accept requests from the app's own pages.

## Local development

```bash
npm install
cp .env.example .env.local   # fill in the keys
npm run dev
```

Add `http://localhost:3000/*` to the browser key's allowed websites to see the map locally.

## Closed places

Spot search asks Google for each place's business status and skips places Google marks as temporarily or permanently closed.

## Fonts

Barlow, SIL Open Font License (`app/fonts/OFL.txt`).
