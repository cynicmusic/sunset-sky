// Shared GLSL chunks for the atmosphere passes. Ported verbatim from
// sunset/src/atmosphere/shaderHelpers.js — pure transcriptions of the
// Hillaire 2020 paper (ray/sphere, density profiles, phase functions,
// transmittance LUT parameterization, horizon warp).

export const COMMON_GLSL = /* glsl */ `
const float PI = 3.14159265358979323846;

vec2 raySphereIntersect(vec3 rayOrigin, vec3 rayDir, float sphereRadius) {
  vec3 oc = rayOrigin / sphereRadius;
  float b = dot(oc, rayDir);
  float c = dot(oc, oc) - 1.0;
  float disc = b * b - c;
  if (disc < -1e-6) return vec2(-1.0, -1.0);
  float s = sqrt(max(disc, 0.0));
  return vec2((-b - s) * sphereRadius, (-b + s) * sphereRadius);
}

float rayleighDensity(float altitude, float scaleHeight) {
  return exp(-altitude / scaleHeight);
}

float mieDensity(float altitude, float scaleHeight) {
  return exp(-altitude / scaleHeight);
}

float ozoneDensity(float altitude, float center, float width) {
  return max(0.0, 1.0 - abs(altitude - center) / width);
}

vec3 sampleMediumDensity(vec3 point, float planetRadius,
                         float rayleighSH, float mieSH,
                         float ozoneCenter, float ozoneWidth,
                         bool mieOn, bool ozoneOn) {
  float h = length(point) - planetRadius;
  float r = rayleighDensity(h, rayleighSH);
  float m = mieOn ? mieDensity(h, mieSH) : 0.0;
  float o = ozoneOn ? ozoneDensity(h, ozoneCenter, ozoneWidth) : 0.0;
  return vec3(r, m, o);
}

float rayleighPhase(float mu) {
  return 3.0 / (16.0 * PI) * (1.0 + mu * mu);
}

float miePhase(float mu, float g) {
  float gg = g * g;
  float num = 3.0 * (1.0 - gg) * (1.0 + mu * mu);
  float den = (8.0 * PI) * (2.0 + gg) * pow(max(1.0 + gg - 2.0 * g * mu, 1e-4), 1.5);
  return num / den;
}

vec2 getTransmittanceLUTUv(vec3 samplePoint, vec3 lightDir,
                           float planetRadius, float atmosphereRadius) {
  vec3 up = normalize(samplePoint);
  float mu = dot(up, lightDir);
  float radius = length(samplePoint);
  float u = mu * 0.5 + 0.5;
  float v = clamp((radius - planetRadius) / max(atmosphereRadius - planetRadius, 1e-5),
                  0.0, 1.0);
  return vec2(u, v);
}
`;

export const HORIZON_WARP_GLSL = /* glsl */ `
float encodeLatitude(float l, bool warp) {
  if (!warp) return clamp(l / PI + 0.5, 0.0, 1.0);
  float a = clamp(abs(l) / (PI * 0.5), 0.0, 1.0);
  return 0.5 + 0.5 * sign(l) * sqrt(a);
}

float decodeLatitude(float v, bool warp) {
  if (!warp) return (v - 0.5) * PI;
  float s = 2.0 * v - 1.0;
  return sign(s) * (PI * 0.5) * s * s;
}
`;

export const FULLSCREEN_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 1.0);
}
`;
