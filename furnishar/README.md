# FurnishAR — *Furnish before you move in*

Enter your room's dimensions, pick a style and budget, and three agents design the room
with real IKEA products. The result renders as an interactive 3D model.

## Quick start

```bash
cd furnishar
npm install
cp .env.example .env.local   # then add your GEMINI_API_KEY
npm run dev                  # http://localhost:3000
```

If `GEMINI_API_KEY` isn't set, or an Argon call fails, the Designer switches to a
deterministic offline layout engine (`lib/fallbackDesigner.ts`), so the demo never dead-ends.
The agent panel always says which engine produced the layout.

## The agent pipeline

| Agent | Engine | File |
| --- | --- | --- |
| 1. Room Analyzer | Builds the room geometry directly from manual dimensions; uses Argon only to parse a free-text `description` | `lib/agents.ts → runAnalyzer` |
| 2. Designer | Gemini 4 Argon (`gemini-4-argon`), receiving the catalog, room, preferences and any verifier violations | `lib/agents.ts → runDesigner` |
| 3. Verifier | **Deterministic TypeScript, no AI.** Checks bounds, AABB collisions, 60 cm walkways, 80 cm door clearance and budget | `lib/verification.ts` |

`POST /api/pipeline` runs 1 → 2 → 3 and streams `AgentStep` updates over SSE. If the Verifier
fails the plan, its machine-readable violations go back to the Designer, with up to 2 retries.
Each attempt is streamed, so the 3D room re-arranges live as the agents fix problems.

The agents are also exposed individually: `/api/analyze`, `/api/design` (also handles refinements), `/api/verify`.

## Coordinates

Floor-plan meters with the origin at the north-west corner; `x` runs along the width and `y` along the length.
`position` is the **center** of a piece. Rotation 0 puts the piece's back against the north wall,
90 against the west wall, 180 against the south wall and 270 against the east wall. The default room has a door on
the north wall and a window on the south wall.

## Pages

- `/` — room setup, style, budget, priority chips
- `/design` — 3D viewer (orbit, click for details, red outlines on violations), agent status, catalog and refine tabs, budget bar
- `/review` — shopping list with IKEA links and a copy-to-clipboard button

## Smoke test

```bash
npx tsx scripts/smoke.ts   # runs the offline designer + verifier on a few room sizes
```

## Photo mode (`/photo`)

Upload a photo of a real room and see IKEA pieces placed into it:

| Agent | Engine | What it does |
| --- | --- | --- |
| Room Analyzer | Gemini 4 Argon (vision) | Finds up to 3 empty spaces, estimates their size from reference objects (outlets, TV, baseboards), and reads the room's style and colours |
| Designer | Gemini 4 Argon | Suggests 2–3 catalog products per space that suit the room and budget |
| Verifier | Deterministic code (`checkFit` in `lib/photo.ts`) | Checks each product's real IKEA width against the space; flags depth and height problems. Typing a tape measurement re-checks instantly |
| Visualizer | Gemini image model (`gemini-3.1-flash-image` by default) | Edits the photo to add the chosen piece; pieces can be stacked, undone, and compared with the original |

Photo mode needs `GEMINI_API_KEY`; there is no offline fallback for it. Override the image model with
`GEMINI_IMAGE_MODEL` in `.env.local`. Sizes read from a photo are estimates, and the rendered picture is an AI
visualization, but the product sizes and prices are IKEA's real ones.
