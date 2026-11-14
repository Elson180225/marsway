# PR #9 science recheck: approved at b064dda

Kelly science sign-off for **`b064ddacaafa05e92a7a48c7a356d4f45c2986e2`** in [PR #9](https://github.com/Elson180225/marsway/pull/9). This supersedes the outstanding four layer-panel findings from the initial `3e4b836` review. It covers the science content and local browser behavior of these four Planning layer panels; it does not change PR draft status, merge the branch, or certify deployment or physical-phone behavior.

The exact commit was checked out in an isolated temporary worktree, with the local app served on port 5174. Browser evidence: headless Chrome, 1440 × 1200 viewport, 14 November 2026. Kelly's app implementation files and Aaron's branch were not edited.

| Panel | Science check | Result |
|---|---|---|
| CTX | About 5 m pixels; uncontrolled mosaic; registration unverified; offsets of tens of metres or more possible; matching crop bounds do not prove alignment. NASA/JPL/MSSS/Murray Lab credit and Esri hosting are visible; source points to Murray Lab. | Pass |
| CRISM HYD | About 19 m, 2012 prototype; qualitative signals rather than percentages or ridge identification. Separate key: green/yellow monohydrated sulfates, magenta polyhydrated sulfates, blue other hydrated signals. Credit names NASA/JPL/JHUAPL and the mosaic team; source points to the HYD product. | Pass |
| CRISM ALT | Same resolution/prototype and interpretation caveats. Separate key: green/blue-green sulfate signals, red Fe/Mg clay signals. Credit names NASA/JPL/JHUAPL and the mosaic team; source points to the ALT product. | Pass |
| THEMIS | About 163 m delivered pixels and about 18 across the area; relative night infrared brightness, not calibrated temperature, thermal inertia, current weather or reliable material classification. Fine underlying relief is explicitly attributed to the terrain basemap. NASA/JPL-Caltech/ASU credit and Mars Trek source link are visible. | Pass |

HYD/ALT blank-pixel and unverified-alignment caveats are present. Displayed credits, legends and resolution wording match Kelly's checked-in product sidecars. Source-link targets were inspected; this recheck does not claim a fresh successful download from the external source services. The THEMIS link opens the Mars Trek viewer; the exact mosaic identifier remains documented in `themis_night.json` and `SUBMISSION-SOURCES.md`.

## Functional checks and tests

- Each of the four buttons loads its expected 600 × 600 local raster and updates the panel.
- Only one science button remains active when switching between orbital layers. Toggling off clears it.
- Route and return paths remain present and visually visible in all four captures.
- Selecting Boxwork Lookout with each layer active preserves its nearby-photo label, credit and source.
- Blocking the CTX request produces a failure message while retaining the science explanation, credit and source panel.
- `node src/science-stops.test.js` — passed.
- `node src/route-integration.test.js` — passed.
- `npm.cmd run build` — passed for both Planning and Walk entries.

Tests were run from `app/` in the isolated checkout of the exact reviewed commit. Previous Walk and PR #10 findings are outside this panel recheck; a branch based before PR #10 does not itself include the merged visit-time UI.

## Evidence

- [CTX panel](pr9-layer-ctx.png)
- [CRISM HYD panel](pr9-layer-crismHyd.png)
- [CRISM ALT panel](pr9-layer-crismAlt.png)
- [THEMIS panel](pr9-layer-themis.png)
- [Image-load failure with retained attribution](pr9-layer-load-failure.png)
- [Rendered panel values and assertions](pr9-browser-review.json)

**Decision:** no outstanding science-content blockers for these four panels at `b064dda`. Aaron may mark PR #9 ready for review from Kelly's science perspective. Any later panel/data changes need a recheck; release/merge decisions and other team checks remain separate.
