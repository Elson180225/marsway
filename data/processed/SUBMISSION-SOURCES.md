# Kelly's image and data sources for submission

Prepared 14 November 2026 from the checked-in stop records and orbital sidecars. This list covers Kelly's four orbital images and four rover photos, plus the terrain and waypoint sources that locate them. Elson and Mia should add their final safety/radiation references and any other assets actually used in the submitted app; planned datasets in the project README are not automatically datasets used.

## Orbital layers

| App image | Dataset and source links | Credit to display | Resolution and limits |
|---|---|---|---|
| `ctx.png` | [Murray Lab Global CTX Mosaic](https://murray-lab.caltech.edu/CTX/), beta01 uncontrolled; [actual Esri tile service](https://astro.arcgis.com/arcgis/rest/services/OnMars/CTX/MapServer) | NASA/JPL/MSSS/The Murray Lab (Caltech); tiles hosted by Esri. Mosaic reference: Dickson et al. (2023). | About 5 m/pixel; delivered tiles 5.09 m/pixel. Registration to the DEM is unverified; offsets of tens of metres or more remain possible. This is orbital context imagery, not a boulder survey or calibrated reflectance. |
| `crism_hyd.png` | [CRISM team Gale landing-site mosaics](http://crism.jhuapl.edu/msl_landing_sites/index_news.php); [HYD source PNG](http://crism.jhuapl.edu/msl_landing_sites/2012July_Mosaics/HYD/MSL_gale_crater_targeted_mosaic_HYD_120723.png) | NASA/JPL/JHUAPL; mosaics by F. Seelos, K. Seelos and C. Viviano (CRISM team). | 23 July 2012 MTRDR prototype browse mosaic, about 19.3 m/pixel. Qualitative hydrated-mineral spectral signals, not mineral percentages or identification on an individual ridge. |
| `crism_alt.png` | [CRISM team Gale landing-site mosaics](http://crism.jhuapl.edu/msl_landing_sites/index_news.php); [ALT source PNG](http://crism.jhuapl.edu/msl_landing_sites/2012July_Mosaics/ALT/MSL_gale_crater_targeted_mosaic_ALT_120723.png) | NASA/JPL/JHUAPL; mosaics by F. Seelos, K. Seelos and C. Viviano (CRISM team). | Same prototype, about 19.3 m/pixel. Qualitative alteration signals. Blank/transparent pixels can reflect missing coverage or weak signal; they do not prove mineral absence. Registration to the DEM has not been independently validated. |
| `themis_night.png` | THEMIS IR night mosaic v14, 60°N–60°S; [NASA Mars Trek product capabilities](https://trek.nasa.gov/tiles/Mars/EQ/Mars_MO_THEMIS-IR-Night_mosaic_60N60S_100m_v14_clon0_ly/1.0.0/WMTSCapabilities.xml); [Mars Trek viewer](https://trek.nasa.gov/mars/) | NASA/JPL-Caltech/Arizona State University; tiles from NASA Mars Trek. | Nominal mosaic 100 m/pixel; delivered tiles about 162.8 m/pixel, only about 37 source pixels across the 6 km area. Relative night infrared brightness from multiple observations, not calibrated temperature in °C/K, thermal inertia or current weather. |

The source instruments are CTX and CRISM on Mars Reconnaissance Orbiter, and THEMIS on Mars Odyssey. All four local outputs are cropped/resampled to 600 × 600 pixels over the same 3 km square. Matching crop bounds and a 5 m output spacing do not create new detail or establish exact instrument alignment. When the raster is translucent, fine relief underneath belongs to the terrain basemap, not to the coarse orbital product.

Source URLs above preserve the product provenance in the scripts. The original CRISM pages and tile-service endpoints were not reachable through the review's web tool; a failed fetch does not establish that the files have been independently revalidated. Keep the local copies and these links in the submission.

## Curiosity photographs

The sol and camera below belong to the photograph. `waypoint_sol` in the stop JSON belongs to the coordinate and can differ. Stop names describe proposed astronaut activities rather than official names of surveyed sampling sites.

| Order / stop | Photograph sol and camera | Credit | Source link | Location label |
|---|---|---|---|---|
| 1 — Boxwork Lookout | Sol **4657**; **Right Navigation Camera (Navcam)**; 12 September 2025, 00:50:58 UTC | NASA/JPL-Caltech | [Boxworks With a View](https://science.nasa.gov/blog/curiosity-blog-sols-4655-4660-boxworks-with-a-view/) | **Nearby view**: associated sol 4655 workspace is about 19.5 m from the sol 4660 coordinate waypoint. |
| 2 — Ridge Sample | Sol **4671**; **Left Navigation Camera (Navcam)**; 26 September 2025, 12:54:44 UTC | NASA/JPL-Caltech | [Winding Our Way Along](https://science.nasa.gov/blog/curiosity-blog-sols-4668-4674-winding-our-way-along/) | Taken from the sol 4671 coordinate waypoint; the ridge pictured lies ahead of the camera. |
| 3 — Hollow Comparison | Sol **4662**; **Left Navigation Camera (Navcam)**; 17 September 2025, 05:25:51 UTC | NASA/JPL-Caltech | [Peaking Into the Hollows](https://science.nasa.gov/blog/curiosity-blog-sols-4661-4667-peaking-into-the-hollows/) | **Nearby view**: camera waypoint about 179 m south of the stop's sol 4609 waypoint. |
| 4 — Mineral Investigation, optional bonus | Sol **4564**; **Mast Camera (Mastcam)**; 8 June 2025, 13:57:45 UTC | NASA/JPL-Caltech/MSSS | [Altadena Drill Hole and Tailings](https://science.nasa.gov/blog/curiosity-blog-sols-4568-4569-a-close-look-at-the-altadena-drill-hole-and-tailings/) | **Nearby view** of the Altadena drill hole. Stop uses the sol 4560 waypoint; NASA described a bump of less than 4 m within the workspace before drilling. |

Local photo files are `app/public/photos/boxwork-lookout.jpg`, `ridge-sample.jpg`, `hollow-comparison.jpg` and `mineral-investigation.jpg`. These are the NASA blog web renditions, not images generated for MarsWay.

Additional source for the short repositioning at Altadena: [NASA, Sols 4561–4562: Prepping to Drill at Altadena](https://science.nasa.gov/blog/sols-4561-4562-prepping-to-drill-at-altadena/).

Product identifiers, for traceability:

- Boxwork Lookout: `NRB_810906228EDR_S1182538NCAM00594M_`
- Ridge Sample: `NLB_812159242EDR_F1190486NCAM00293M_`
- Hollow Comparison: `NLB_811354716EDR_F1182832NCAM00282M_`
- Mineral Investigation: `4564MR1077420012302300E01_DXXX`

## Terrain and coordinate sources for Elson's submission list

| Use | Source | Credit / treatment |
|---|---|---|
| Area, elevation, derived slope/roughness and shaded colour basemap | [USGS Mars MSL Gale Merged DEM 1m, version 3](https://astrogeology.usgs.gov/search/map/mars_msl_gale_merged_dem_1m); [original TIFF](https://planetarymaps.usgs.gov/mosaic/Mars/MSL/MSL_Gale_DEM_Mosaic_1m_v3.tif) | Timothy Parker and Fred J. Calef III; JPL-Caltech, NASA, USGS Astrogeology Science Center and University of Arizona. Terrain products prepared by the MarsWay team. `basemap.png` is derived colour relief, not a HiRISE photograph. The source merges multiple terrain datasets; a 1 m raster spacing does not guarantee uniform 1 m effective resolution or metre-accurate absolute location. |
| Stop coordinates and local Curiosity track | [NASA/JPL MSL waypoint JSON](https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints.json) | NASA/JPL-Caltech, Mars Science Laboratory / Curiosity team. MarsWay converts geographic positions to the shared local grid. Photo-to-stop offsets are approximate local waypoint distances. |

## Submission-ready credit paragraph

MarsWay uses NASA mission imagery and data: CTX imagery from NASA/JPL/MSSS and The Murray Lab (Caltech), served by Esri; CRISM Gale prototype mineral browse mosaics from NASA/JPL/JHUAPL, prepared by F. Seelos, K. Seelos and C. Viviano; THEMIS night infrared imagery from NASA/JPL-Caltech/Arizona State University via NASA Mars Trek; and Curiosity Navcam photographs credited to NASA/JPL-Caltech and Mastcam imagery credited to NASA/JPL-Caltech/MSSS. Terrain derives from the USGS MSL Gale Merged DEM v3 by Timothy Parker and Fred J. Calef III, with local terrain products prepared by MarsWay. Stop coordinates use NASA/JPL Curiosity waypoints. Orbital alignment is approximate, mineral colours are qualitative, and the THEMIS layer represents relative night brightness rather than calibrated temperature. Astronaut stops and their visit durations are team proposals.

Keep the linked tables with this paragraph so each dataset and photograph has its own source. Acknowledgement does not imply NASA endorsement.


## Radiation and weather sources

**Radiation (used in the app)**
- **Surface dose baseline:** Hassler et al. (2014), "Mars' Surface Radiation Environment Measured with the Mars Science Laboratory's Curiosity Rover", *Science* 343, 1244797, doi:10.1126/science.1244797. Measured 0.64 ± 0.12 mSv/day at Gale Crater. MarsWay uses 0.67 mSv/day, within this measured range (about 0.17 mSv for a 6-hour walk). Credit: Curiosity RAD / MSL science team.
- **Solar storm (2× dose rate, team assumption based on):** NASA JPL news, 29 Sept 2017 (the 11 Sept 2017 event "more than doubled" RAD readings); Hassler et al. (2018), *Space Weather*, doi:10.1029/2018SW001959; Zeitlin et al. (2018), *Geophysical Research Letters*, doi:10.1029/2018GL077760.
- **Habitat shielding (half the outside dose, team assumption between):** published regolith-shielding studies, including Planetary and Space Science (2022, about 41% less behind 1 m of regolith) and a TU Delft MGS-1 study (more than 90% less behind 2.5 m).
- **Career limit (600 mSv):** NASA-STD-3001 Volume 1; NASA OCHMO radiation protection technical brief.

**Weather (background references only, no data imported)**
- **REMS, Curiosity's weather station:** NASA PDS Atmospheres Node REMS archive, https://atmos.nmsu.edu/data_and_services/atmospheres_data/MARS/curiosity/rems.html. Credit: Curiosity REMS science team; NASA Planetary Data System, Atmospheres Node.
- **Mars Climate Database:** https://www-mars.lmd.jussieu.fr/mars/info_web/index.html. Credit: LMD/CNRS and collaborating institutions, supported by ESA/CNES. Modelled climate and dust scenarios, not live weather.

**Our own assumptions (not measured values)**
- Dust-storm walking slowdown (0.6× speed), the solar-storm factor (2×) and habitat shielding (0.5×) are team simulation assumptions.
- The radiation counter is a baseline estimate, not a personal dose measurement or a solar-storm forecast.

## 15 November: full 6 km orbital re-cut

The four orbital layers now use projected bounds west 8141000, east 8147000, south -287000, north -281000, with north at row 0 and 5 m output spacing. CTX and THEMIS have visible data over the entire crop. CRISM HYD and ALT show browse colour over about 67%; the remaining roughly 33% is transparent (missing/weak/obscured signal or browse stretch floor, not proof of absent minerals). Source resolution remains about 5.09 m for CTX, 19.3 m for CRISM and 162.8 m for the delivered THEMIS tiles. Metadata in `data/processed/` uses the active `app/public/terrain/area.json`, not the older 3 km `data/processed/area.json`. See `ORBITAL-LAYERS-6KM.md` for reproducibility and review evidence.
