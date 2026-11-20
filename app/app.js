'use strict';

const frame = document.querySelector('#room-frame');
const message = document.querySelector('#room-message');
const nextButton = document.querySelector('#next-scene');
const previewControls = document.querySelector('#preview');
const overrides = new URLSearchParams(location.search);
let data;
let currentSelection;
let targetSelection;
let previewBand = null;
let useInitialBandOverride = true;
let requestId = 0;
let pendingVideo;
let displayedImagePath;
let displayedScene;
let loadingImage = false;

function tokyoTime(timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hour: 'numeric', month: 'numeric', hourCycle: 'h23'
  }).formatToParts(new Date());
  return Object.fromEntries(parts.map(({ type, value }) => [type, Number(value)]));
}

function bandAt(hour, bands) {
  return Object.keys(bands).find(key => {
    const { startHour, endHour } = bands[key];
    return startHour < endHour
      ? hour >= startHour && hour < endHour
      : hour >= startHour || hour < endHour;
  });
}

function chooseSelection(bandOverride = null, allowSceneOverride = false) {
  const { scenes } = data;
  const time = tokyoTime(scenes.timezone);
  const forcedScene = allowSceneOverride && scenes.scenes.find(item => item.id === overrides.get('scene') && !item.special);
  const forcedBand = useInitialBandOverride && overrides.get('band');
  const band = bandOverride || (scenes.bands[forcedBand] ? forcedBand : (forcedScene?.band || bandAt(time.hour, scenes.bands)));
  const variants = scenes.bands[band].variants;
  const scene = forcedScene && variants.includes(forcedScene.id)
    ? forcedScene.id : variants[Math.floor(Math.random() * variants.length)];
  const forcedSeason = overrides.get('season');
  const season = Object.prototype.hasOwnProperty.call(scenes.seasons, forcedSeason)
    ? forcedSeason : Object.keys(scenes.seasons).find(key => scenes.seasons[key].includes(time.month));
  return { band, scene, season, edition: season === 'winter' ? 'winter' : 'normal' };
}

function windowKind(label) {
  const cases = data.scenes.rules.weatherLabelToWindowKind.cases;
  for (const rule of cases) {
    if (rule.labelAbsent && !label) return rule.windowKind;
    if (label && rule.containsAny && rule.containsAny.some(text => label.includes(text)) &&
        (!rule.containsNone || rule.containsNone.every(text => !label.includes(text)))) return rule.windowKind;
    if (rule.otherwise) return rule.windowKind;
  }
  return null;
}

function weatherViewKey(selection) {
  const kind = windowKind(weatherLabel);
  const rules = data.scenes.rules;
  const night = selection.band === 'night';
  if (kind === null) return rules.fallback.nullWindowKind[night ? 'night' : 'daytime'];
  if (night) return rules.windowKindToViewKey.night[kind] || rules.windowKindToViewKey.night.otherwise;
  const day = rules.windowKindToViewKey.daytime;
  if (kind === 'rain' || kind === 'snow') return day[kind];
  return kind + day.sunnyOrCloudy.seasonSuffix[selection.season];
}

function effectiveSelection(selection) {
  const rule = data.scenes.rules.rainDay;
  if (weatherLabel && rule.bands.includes(selection.band) && rule.labelContainsAny.some(text => weatherLabel.includes(text))) {
    return { ...selection, scene: rule.scene };
  }
  return selection;
}

function mediaPath(selection, key, ext) {
  const { media } = data.scenes;
  const suffix = (media.editionSuffix.overrides[selection.scene] || media.editionSuffix.default)[selection.edition];
  return media.filePattern.replaceAll('{scene}', selection.scene)
    .replace('{editionSuffix}', suffix).replace('{viewKey}', key).replace('{ext}', ext);
}

function resolveMedia(selection) {
  const { media, rules } = data.scenes;
  const displaySelection = effectiveSelection(selection);
  const group = Object.values(media.viewKeys).find(item => item.scenes.includes(displaySelection.scene));
  const keys = group[selection.edition];
  const requested = displaySelection.scene !== selection.scene ? 'rain' : (overrides.get('viewKey') || weatherViewKey(selection));
  const candidates = rules.fallback.mediaResolutionOrder.flatMap(item =>
    item === 'viewKey' ? [requested] : item === 'firstAvailable' ? keys : [item]);
  for (const key of candidates) {
    if (!keys.includes(key)) continue;
    const image = mediaPath(displaySelection, key, 'webp');
    if (data.manifest.has(image)) {
      const video = mediaPath(displaySelection, key, 'mp4');
      return { image, video: data.manifest.has(video) ? video : null };
    }
  }
  throw new Error('表示できる素材が見つかりません');
}

function assetUrl(path) {
  return new URL('../' + path, location.href).href;
}

function stopVideo(video) {
  if (!video) return;
  video.pause();
  video.removeAttribute('src');
  video.load();
}

// All scene changes, including caption selection, go through here.
async function showSelection(selection) {
  targetSelection = selection;
  let id = requestId;
  try {
    const paths = resolveMedia(selection);
    if (currentSelection && displayedImagePath === paths.image) {
      if (loadingImage) { ++requestId; loadingImage = false; }
      currentSelection = selection;
      displayedScene = effectiveSelection(selection).scene;
      selectCaption(selection);
      return;
    }
    id = ++requestId;
    stopVideo(pendingVideo);
    pendingVideo = null;
    const image = new Image();
    image.alt = 'mocoのお部屋';
    image.src = assetUrl(paths.image);
    loadingImage = true;
    await image.decode();
    if (id !== requestId) return;
    loadingImage = false;
    stopVideo(frame.querySelector('video'));
    frame.replaceChildren(image);
    frame.setAttribute('aria-busy', 'false');
    currentSelection = selection;
    displayedImagePath = paths.image;
    displayedScene = effectiveSelection(selection).scene;
    selectCaption(selection);
    if (!paths.video) return;

    const video = document.createElement('video');
    pendingVideo = video;
    video.muted = true;
    video.autoplay = true;
    video.loop = true;
    video.playsInline = true;
    video.poster = image.src;
    video.setAttribute('aria-label', 'mocoのお部屋');
    video.preload = 'auto';
    video.addEventListener('error', () => {
      if (id === requestId && frame.contains(video)) frame.replaceChildren(image);
    });
    video.src = assetUrl(paths.video);
    await new Promise((resolve, reject) => {
      video.addEventListener('canplay', resolve, { once: true });
      video.addEventListener('error', reject, { once: true });
    });
    if (id !== requestId) return;
    await video.play();
    if (id !== requestId) { stopVideo(video); return; }
    frame.replaceChildren(video);
    pendingVideo = null;
  } catch (error) {
    if (id !== requestId) return;
    loadingImage = false;
    stopVideo(pendingVideo);
    pendingVideo = null;
    frame.setAttribute('aria-busy', 'false');
    if (!currentSelection) message.textContent = 'お部屋を読み込めませんでした。しばらくしてから再読み込みしてください。';
    if (currentSelection !== selection) targetSelection = currentSelection;
    console.error(error);
  }
}

function weatherChanged() {
  if (targetSelection) showSelection(targetSelection);
}

function refresh() {
  if (previewBand) return;
  const selection = chooseSelection(null, useInitialBandOverride);
  if (!targetSelection || selection.band !== targetSelection.band || selection.edition !== targetSelection.edition) {
    showSelection(selection);
  }
}

nextButton.addEventListener('click', () => {
  if (!targetSelection) return;
  const variants = data.scenes.bands[targetSelection.band].variants;
  const scene = variants[(variants.indexOf(targetSelection.scene) + 1) % variants.length];
  showSelection({ ...targetSelection, scene });
});

previewControls.addEventListener('click', event => {
  const button = event.target.closest('button[data-band]');
  if (!button) return;
  useInitialBandOverride = false;
  previewBand = button.dataset.band === 'now' ? null : button.dataset.band;
  for (const item of previewControls.querySelectorAll('button')) {
    item.setAttribute('aria-pressed', String(item === button));
  }
  showSelection(chooseSelection(previewBand));
});

async function start() {
  try {
    const responses = await Promise.all(['../data/scenes.json', '../data/manifest.json', '../data/captions.json'].map(url => fetch(url)));
    if (responses.some(response => !response.ok)) throw new Error('データの読み込みに失敗しました');
    const [scenes, manifest, captions] = await Promise.all(responses.map(response => response.json()));
    data = { scenes, captions, manifest: new Set(manifest.map(item => item.path)) };
    document.querySelectorAll('#reactions button').forEach(button => { button.disabled = false; });
    nextButton.disabled = false;
    previewControls.disabled = false;
    refresh();
    refreshWeather();
    setInterval(refresh, 60_000);
    setInterval(refreshWeather, 30 * 60_000);
  } catch (error) {
    frame.setAttribute('aria-busy', 'false');
    message.textContent = 'お部屋を読み込めませんでした。しばらくしてから再読み込みしてください。';
    console.error(error);
  }
}
document.addEventListener('DOMContentLoaded', start);
