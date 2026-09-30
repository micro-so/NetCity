# NetCity 2000

**Your network, zoned.** A SimCity 2000–style isometric city built from your relationship graph on [Micro Blocks](https://micro.so/blocks).

- **Companies are buildings.** Floors = the number of people you know there. Only companies you've touched in the last 30 days get a building.
- **Districts are industries**, each with its own architecture: limestone VC banks with gold crowns, dark-glass AI towers with violet LED bands, brick dev-tools lofts with water tanks, timber climate terraces, neon crypto ziggurats, and so on.
- **People are sims.** The 100 people you talked to most recently walk the streets, dressed for their role (VCs in fleece vests, founders in hoodies, designers in black turtlenecks, sales in suits).
- **Click a building** to walk into its office: a floor plan per industry (VC boardroom, AI lab with server racks, brick loft with ping-pong, cubicle farm, broadcast studio…) with everyone you know at their desk. Click a person for their card.
- **City Hall** sits in the middle: settings, map choice, and a bronze statue of the mayor made from your photo (processed in the browser; only a 16×20 grid is saved, locally).
- **Three maps:** Default (a waterfront island), **San Francisco** (Golden Gate, Bay Bridge, Alcatraz, Sutro Tower, fog, Waymos) and **New York** (Central Park, Brooklyn Bridge, Liberty, Empire State, One WTC, yellow cabs).
- Day / golden hour / night (windows light up), whales in the bay, company logos on roofs, signs and facades.

Everything is drawn in code as pixel art — no image assets, no build step.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:8762. Add `?map=sf` or `?map=nyc` to jump to a map. (Demo mode also works from any static server, e.g. `python3 -m http.server`.)

It starts in **demo mode** with a made-up network. Every name, company and email in the demo is fictional.

## Connect your real network (Micro Blocks)

1. Get an API key and Team ID in Micro: **Settings → API** ([sign up](https://app.micro.so/login?intent=blocks)).
2. Put these in `.env` for `npm run dev`, or set them on Vercel:

   ```bash
   MICRO_API_KEY=...
   MICRO_TEAM_ID=...
   ```

   On any host other than localhost, also set `NETCITY_ACCESS_TOKEN` and enter the same value in **City Hall → Access token** — otherwise the API refuses to serve your network.

3. Open the city with `?real` (or pick **My Micro network** in City Hall). The browser calls `/api/city`, a small serverless function that reads your organizations and contacts from Micro. The key stays on the server.

The function is **read-only** — it never writes to Micro. It uses [`@micro-so/sdk`](https://www.npmjs.com/package/@micro-so/sdk) and builds the city from:

- **organizations** you've interacted with in the last 30 days (up to `NETCITY_MAX_COMPANIES`, default 300), with their `about`/`summary`;
- **identities** — one per real person, found through the contacts at those companies — with `summary`, `about`, title and relationship strength.

The first build can take a few minutes on a large network. After that the result is cached (in the OS temp folder) and refreshed in the background, so the city opens in seconds.

## Files

| File | What it does |
|---|---|
| `index.html` | Page shell, UI panels, styles |
| `data.js` | Demo data (shaped like Micro Prism responses) and the normalizer |
| `sprites.js` | Pixel-art factory: buildings by industry, logos, people, cars, trees, bridges, landmarks, day/night |
| `game.js` | Map layout, terrain, rendering, street life, whales, input |
| `office.js` | Office interiors and person cards |
| `civic.js` | City Hall settings and the photo → bronze statue |
| `api/city.js` | Serverless proxy to the Micro Blocks API |
| `api/logo.js` | Same-origin logo proxy so real logos can be painted onto roofs |

## License

MIT. City and landmark likenesses are affectionate pixel homages; company logos in demo mode are generated.
