# Planning scenario handoff

Planning keeps the existing terrain route geometry and adds a *simulated* storm
start in UTC. `planningWeather.js` applies a 0.6 walking-speed factor only to
the portion of each walk after that time. `missionSchedule.js` and the Planning
safety worker use the same function. The latest safe turn-back departure is
solved against the fixed storm start, so a storm that begins during the future
return does not overstate the margin. Clear weather is unchanged.

The factor is a team demo assumption, not a REMS measurement. The 3 km
`app/public/terrain` grid and Mia's 3 km home file stay in service. The new
6 km processed dataset in `data/processed/area-6km` is **not** connected to
Planning yet: H1 coordinates, Kelly's overlays/stops, and the home file must
be regenerated and checked together before switching grids.

The two CSV downloads use the agreed headers. They are proposed events, not a
completed EVA log. `stops_visited`, `bonus_done`, and `running_total_msv` are
empty because Planning cannot know those actual values. The dose uses the
Curiosity RAD baseline (0.67 mSv/day) for surface time, including science
visits. Storm radiation and shielding are not included; the UI states this.
Russell's Walk screen and its eventual actual-event CSV remain separate.

Run from `app/`: `node src/planningScenario.test.js`,
`node src/missionSchedule.test.js`,
`node src/safezone/planningIntegration.test.js`, and `npm run build`.
