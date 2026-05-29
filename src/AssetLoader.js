import {
  Data3DTexture,
  LinearFilter,
  LoadingManager,
  NoColorSpace,
  RedFormat,
  RepeatWrapping,
  TextureLoader,
} from 'three';
import { PrecomputedTexturesLoader } from '@takram/three-atmosphere';
import {
  DataTextureLoader,
  STBNLoader,
  parseUint8Array,
} from '@takram/three-geospatial';

const ASSET_BASE_URL = import.meta.env.BASE_URL || '/';
const ASSET_BASE = new URL(ASSET_BASE_URL, window.location.href);
const ATMOSPHERE_URL = new URL('atmosphere/', ASSET_BASE).href;
const CLOUDS_URL = new URL('clouds/', ASSET_BASE).href;

let islandAssetsPromise = null;

export function loadIslandAssets({ onProgress } = {}) {
  if (islandAssetsPromise) return islandAssetsPromise;

  const manager = new LoadingManager();
  manager.onProgress = (url, loaded, total) => {
    onProgress?.({ url, loaded, total, label: `${loaded}/${total}` });
  };

  const atmosphereLoader = new PrecomputedTexturesLoader({
    format: 'binary',
    combinedScattering: false,
    higherOrderScattering: true,
  }, manager);

  islandAssetsPromise = Promise.all([
    loadPrecomputedTextures(atmosphereLoader),
    loadCloudTextures(manager),
  ]).then(([atmosphere, clouds]) => ({ atmosphere, clouds }));

  return islandAssetsPromise;
}

export function resetIslandAssetsCacheForTests() {
  islandAssetsPromise = null;
}

function loadPrecomputedTextures(loader) {
  return new Promise((resolve, reject) => {
    loader.load(ATMOSPHERE_URL, resolve, undefined, reject);
  });
}

async function loadCloudTextures(manager) {
  const textureLoader = new TextureLoader(manager);
  const shapeLoader = makeCloudVolumeLoader(128, manager);
  const shapeDetailLoader = makeCloudVolumeLoader(32, manager);
  const stbnLoader = new STBNLoader(manager);

  const [
    localWeatherTexture,
    shapeTexture,
    shapeDetailTexture,
    turbulenceTexture,
    stbnTexture,
  ] = await Promise.all([
    loadTexture(textureLoader, `${CLOUDS_URL}local_weather.png`, configureDataTexture2D),
    loadTexture(shapeLoader, `${CLOUDS_URL}shape.bin`),
    loadTexture(shapeDetailLoader, `${CLOUDS_URL}shape_detail.bin`),
    loadTexture(textureLoader, `${CLOUDS_URL}turbulence.png`, configureDataTexture2D),
    loadTexture(stbnLoader, `${CLOUDS_URL}stbn.bin`),
  ]);

  return {
    localWeatherTexture,
    shapeTexture,
    shapeDetailTexture,
    turbulenceTexture,
    stbnTexture,
  };
}

function makeCloudVolumeLoader(size, manager) {
  return new DataTextureLoader(Data3DTexture, parseUint8Array, {
    width: size,
    height: size,
    depth: size,
    format: RedFormat,
    colorSpace: NoColorSpace,
    wrapS: RepeatWrapping,
    wrapT: RepeatWrapping,
    wrapR: RepeatWrapping,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
  }, manager);
}

function loadTexture(loader, url, configure) {
  return new Promise((resolve, reject) => {
    loader.load(url, (texture) => {
      configure?.(texture);
      resolve(texture);
    }, undefined, reject);
  });
}

function configureDataTexture2D(texture) {
  texture.colorSpace = NoColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
}
