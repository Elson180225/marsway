# MarsWay 🔴

**Find your way on Mars, and back home safely.**

MarsWay is a planning and navigation app for astronauts walking on the surface of Mars. It brings data from several NASA missions together on one map, plans the safest walking route to science targets, and shows the crew how far they can go and still get home safely.

> Built for the **NASA Space Apps Challenge 2026** (Sarawak Space Challenge), challenge: **Interplanetary Survival Guide: Martian Map**.

🚧 **Status:** being built during the hackathon, 14–15 November 2026.

---

## The problem

NASA has studied Mars with orbiters and rovers for decades, but that data is spread across many missions, and today's Mars map tools show the planet at a big, zoomed-out scale. An astronaut on foot needs the opposite: a close-up map of the exact area they'll walk through, with everything they need to stay safe in one place.

## What MarsWay does

Think of it as **Google Maps for walking on Mars, with a safety officer built in.**

MarsWay has two screens, both in one web app:

| | 🖥️ Planning screen (website) | 📱 Walk screen (phone) |
|---|---|---|
| **When** | The day before the walk, in the habitat | During the walk |
| **Shows** | Layered map, safest route between stops, walk time, radiation estimate, the "safe to go" zone, real rover photos at each stop | Direction and distance to the next stop, time until turnaround, warnings |

### Planned features

- 🗺️ **Layered map** of our site combining photos, terrain height, ground temperature, minerals, radiation and weather
- 🥾 **Easiest-path routing** that avoids steep and rocky ground, with walking times for a suited astronaut
- 🟢 **"Safe to go" zone** showing where the crew can still reach and return from before their suit reserve runs low
- ⏱️ **Turn-back timer** on the phone screen
- ☢️ **Radiation estimate** for each walk, based on Curiosity's measurements
- ☀️ **Solar storm alert** with a route to the nearest shelter
- 📷 **Real Mars photos** at each stop, so the crew know what to expect

## Our mission: EVA-07, the Boxwork Walk

Our app is built around a fictional future mission at **Gale Crater, near Mount Sharp**, where NASA's Curiosity rover explored "boxwork" in 2025. Boxwork is a web of low rock ridges that likely formed when groundwater left minerals in underground cracks. A two-person crew, supported by a helper rover, walks to four stops to sample the ridges and hollows, then uses MarsWay to decide whether there's time for a bonus stop before heading home.

## NASA data we use

| Data | Source | What it tells the astronaut |
|---|---|---|
| High-resolution images | HiRISE, Mars Reconnaissance Orbiter | What the ground looks like, where the big rocks are |
| 3D height map (DTM) | HiRISE stereo | How steep it is, where they can walk |
| Context images | CTX, Mars Reconnaissance Orbiter | Where they are in the bigger picture |
| Regional elevation | MOLA, Mars Global Surveyor | The shape of the whole Mount Sharp area |
| Ground temperature / thermal inertia | THEMIS, Mars Odyssey | Loose sand or solid rock underfoot |
| Mineral maps | CRISM, Mars Reconnaissance Orbiter | Where the interesting minerals are |
| Radiation | RAD, Curiosity rover | Radiation dose during the walk |
| Weather | REMS, Curiosity rover | Temperature, pressure and UV |
| Surface photos | Curiosity cameras | What each stop looks like from the ground |
| Space weather | NASA DONKI | Solar storm events |

### Resources

From the challenge's official resources:
- [JPL Mars Trek](https://trek.nasa.gov/mars/)
- USGS-NASA Planetary Geologic Mapping Program
- NASA's annotated route map and flyover of Curiosity's proposed route up Mount Sharp
- [Mars Perseverance raw images](https://science.nasa.gov/mission/mars-2020-perseverance/raw-images/)
- [NASA Worldview](https://worldview.earthdata.nasa.gov/) (Earth satellite mapping, used for design inspiration)

Other sources:
- [HiRISE](https://hirise.lpl.arizona.edu/)
- [PDS Geosciences Node](https://pds-geosciences.wustl.edu/)
- [Curiosity mission and raw images](https://science.nasa.gov/mission/msl-curiosity/)
- [NASA DONKI space weather database](https://kauai.ccmc.gsfc.nasa.gov/DONKI/)

## How it works (short version)

1. **Python scripts** prepare the NASA data: cut out our area, work out slope and roughness from the height map, and export map layers.
2. **Route-finding** (A* search) finds the lowest-effort path on a grid, using Tobler's hiking function adjusted for a spacesuit.
3. **The safe zone** comes from a Dijkstra search outward from the habitat, giving the time to walk home from every point.
4. **The web app** shows everything on a Leaflet map, with a mobile layout for the walk screen. It runs fully in the browser, with no server needed.

### Assumptions

These are our own estimates, not official NASA figures, and are easy to change:
- Suit time budget: 8 hours, planned walk 6 hours, 2 hours reserve
- Slope limits: warning above 15°, no-go above 25°
- Suited walking speed: about half of normal hiking speed

## Tech stack

- **Data processing:** Python, GDAL, rasterio, NumPy, QGIS
- **App:** JavaScript, Leaflet, Vite
- **Hosting:** Vercel / GitHub Pages

## Repo structure

```
marsway/
├── data/
│   ├── raw/         # original NASA files (not in Git, see below)
│   └── processed/   # small files the app uses
├── scripts/         # Python data-processing scripts
├── app/             # the web app (website + phone screens)
└── README.md
```

> **Big data files** (HiRISE DTMs, images) are kept in our shared Google Drive, not in this repo. GitHub doesn't allow files over 100 MB.

## Getting started

_Coming during the hackathon._

## Team

| Name | Role |
|---|---|
| Elson | Map Maker 1 + Captain |
| Kelly | Map Maker 2 |
| Nigel | Pathfinder 1 |
| Mia | Pathfinder 2 |
| Aaron | Web Builder |
| Russell | Mobile Builder |

## Acknowledgements

Data courtesy of NASA, JPL-Caltech, the University of Arizona (HiRISE), Arizona State University (THEMIS), the Johns Hopkins University Applied Physics Laboratory (CRISM), the USGS Astrogeology Science Center, and the Mars Science Laboratory and Mars 2020 teams.

## Use of AI tools

_To be completed before submission, as required by Space Apps rules._

---

Made with ❤️ in Sarawak for NASA Space Apps 2026.
