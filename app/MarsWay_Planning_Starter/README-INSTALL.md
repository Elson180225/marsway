# MarsWay Planning starter — Aaron and Russell

This archive contains `app/`, the Vite + plain JavaScript + Leaflet web app. It supplies Aaron's Planning screen, a mock terrain image, toggleable illustration layers, and a shared illustrative JSON route for Russell's Walk screen. It intentionally does not implement or modify `src/screens/Walk/`.

## Install on Aaron's Windows clone

From `C:\Users\User\marsway` in PowerShell, extract the archive so that `app/package.json` exists. Then run:

```powershell
cd app
npm install
npm run dev
```

Open the local address printed by Vite. If an `app/` folder was already scaffolded, copy the four source files, `public/mock-terrain.svg`, and `public/routes/sample-route.json` into it; keep any teammate changes and run `npm install leaflet@1.9.4` if needed.

When ready, commit only the intended files from the repository root:

```powershell
cd ..
git status
git add app/index.html app/package.json app/src/main.js app/src/style.css app/public/routes/sample-route.json app/public/mock-terrain.svg
git commit -m "feat(app): add MarsWay planning prototype and sample route contract"
git push
```

Coordinate before pushing if Russell has started work on the same branch. `git status` should not include `app/node_modules/` or `app/dist/`.

## Shared data contract

Fetch `/routes/sample-route.json`. `x` is metres east and `y` is metres north in a local illustrative grid. For Leaflet `CRS.Simple`, supply `[y, x]`. `stops` are in visit order; `legs[i]` joins `stops[i]` to `stops[i+1]`. `path` is an ordered array of `{x,y}` points. `distance_m` and `walk_minutes` are scenario estimates, not calculated from pixel length. `returns` has one return-home path for every stop. Warnings have `type`, `level` (`info`, `caution`, `danger`) and `message`.

Mission times are ISO 8601 UTC; `recorded` or live sensor readings are not represented. The UI shows UTC explicitly. Sample scenario values must be replaced or validated with the pathfinders' data before any real route claim. Route polygons in the map are illustrative placeholders, not NASA data.

## Early Vercel deployment

After pushing the app to the shared GitHub repository, import `Elson180225/marsway` into Vercel and set **Root Directory** to `app`. Use the **Vite** framework preset, build command `npm run build`, output directory `dist`, and default install command `npm install`. Share the deployment URL with Elson and Russell. The placeholder route must remain labelled illustrative; no actual NASA imagery is included yet.
