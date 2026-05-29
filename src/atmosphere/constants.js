// Hillaire 2020 Table 1 atmospheric coefficients. Ported verbatim from
// sunset/src/atmosphere/constants.js. The shader works in km / km⁻¹ throughout.
//
// Density profiles:
//   Rayleigh: dr(h) = exp(-h / 8.0 km)
//   Mie:      dm(h) = exp(-h / 1.2 km)
//   Ozone:    do(h) = max(0, 1 - |h - 25| / 15)   (tent, km units)

import * as THREE from 'three';

export const PLANET = {
  // Radii in km. Earth values from Hillaire §4. Atmosphere is a 100 km shell.
  groundRadius: 6371.0,
  atmosphereRadius: 6471.0,

  // Density scale heights (km).
  rayleighScaleHeight: 8.0,
  mieScaleHeight: 1.2,
  ozoneCenter: 25.0,
  ozoneWidth: 15.0,
};

export const BETAS = {
  rayleigh: new THREE.Vector3(0.005802, 0.013558, 0.0331),
  mie: 0.021,
  miePaper: 0.003996,
  mieExtRatio: 1.1,
  ozoneAbs: new THREE.Vector3(0.000650, 0.001881, 0.000085),
};

export const SUN = {
  defaultElevationDeg: 28.0,
  defaultAzimuthDeg: 38.0,
  defaultIntensity: 22.0,
};
