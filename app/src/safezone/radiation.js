/**
 * MarsWay radiation estimate (Pathfinder 2).
 *
 * Curiosity's RAD instrument (Radiation Assessment Detector) measured the radiation dose on the
 * surface of Gale Crater, our site. We use about 0.67 mSv per day, the team's figure.
 * Source: Hassler et al. 2014, "Mars' Surface Radiation Environment Measured with the Mars Science
 * Laboratory's Curiosity Rover", Science 343. (The paper gives 0.64 ± 0.12 mSv/day, so 0.67 is
 * inside its range.) Rough estimate only: real dose changes with the sun, the season and shielding.
 */
export const RAD_SURFACE_MSV_PER_DAY = 0.67

/** Dose in millisieverts for `hours` spent outside on the surface. */
export function walkDoseMSv(hours) {
  return (RAD_SURFACE_MSV_PER_DAY / 24) * hours
}
