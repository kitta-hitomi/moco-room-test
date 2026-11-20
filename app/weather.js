'use strict';

// The only built-in location is the requested default. User choices stay in localStorage.
const DEFAULT_LOCATION = { name: '東京', latitude: 35.6812, longitude: 139.7671 };
const LOCATION_KEY = 'moco-weather-location';
let weatherLabel = overrides.has('weather') ? (overrides.get('weather') || null) : null;
let weatherRequest = 0;
let searchRequest = 0;
let locationRequest = 0;
const weatherStatus = document.querySelector('#weather-status');
const locationMessage = document.querySelector('#location-message');
const results = document.querySelector('#location-results');

function validLocation(value) {
  return value && typeof value.name === 'string' && value.name.length > 0 &&
    Number.isFinite(value.latitude) && Math.abs(value.latitude) <= 90 &&
    Number.isFinite(value.longitude) && Math.abs(value.longitude) <= 180;
}
function getLocation() {
  try {
    const stored = JSON.parse(localStorage.getItem(LOCATION_KEY));
    return validLocation(stored) ? stored : DEFAULT_LOCATION;
  } catch (_) { return DEFAULT_LOCATION; }
}
function updateStatus(location, label) {
  weatherStatus.textContent = `地域：${location.name}　天気：${label || '天気なし'}`;
}
function saveLocation(location) {
  ++locationRequest;
  ++searchRequest;
  try {
    localStorage.setItem(LOCATION_KEY, JSON.stringify(location));
    results.replaceChildren();
    locationMessage.textContent = 'この端末に保存しました。';
    updateStatus(location, null);
    refreshWeather();
  } catch (_) { locationMessage.textContent = '地域を保存できませんでした。'; }
}
async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error('天気情報を取得できません');
  return response.json();
}
function openMeteoLabel(code) {
  if ([0, 1].includes(code)) return '晴れ';
  if ([2, 3, 45, 48].includes(code)) return 'くもり';
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return '雨';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return '雪';
  if ([95, 96, 99].includes(code)) return '雷';
  throw new Error('未対応の天気コード');
}
function metLabel(code) {
  if (typeof code !== 'string') throw new Error('天気コードなし');
  if (code.includes('thunder')) return '雷';
  if (code.includes('snow') || code.includes('sleet')) return '雪';
  if (code.includes('rain')) return '雨';
  if (code.startsWith('clearsky') || code.startsWith('fair')) return '晴れ';
  if (code.startsWith('cloudy') || code.startsWith('partlycloudy') || code.startsWith('fog')) return 'くもり';
  throw new Error('未対応の天気コード');
}
async function loadWeather(location) {
  const params = new URLSearchParams({ latitude: location.latitude, longitude: location.longitude });
  try {
    const open = new URL('https://api.open-meteo.com/v1/forecast');
    open.search = params.toString();
    open.searchParams.set('current', 'weather_code');
    const result = await fetchJson(open);
    return openMeteoLabel(result.current?.weather_code);
  } catch (_) {
    const met = new URL('https://api.met.no/weatherapi/locationforecast/2.0/compact');
    met.search = params.toString();
    const result = await fetchJson(met);
    return metLabel(result.properties?.timeseries?.[0]?.data?.next_1_hours?.summary?.symbol_code ||
      result.properties?.timeseries?.[0]?.data?.next_6_hours?.summary?.symbol_code);
  }
}
async function refreshWeather() {
  const id = ++weatherRequest;
  const location = getLocation();
  let label = null;
  try { label = await loadWeather(location); } catch (_) { /* Both services failed. */ }
  if (id !== weatherRequest) return;
  const oldLabel = weatherLabel;
  weatherLabel = overrides.has('weather') ? (overrides.get('weather') || null) : label;
  updateStatus(location, weatherLabel);
  if (data && oldLabel !== weatherLabel) weatherChanged();
}

document.querySelector('#location-search').addEventListener('submit', async event => {
  event.preventDefault();
  const query = document.querySelector('#location-query').value.trim();
  if (!query) return;
  const id = ++searchRequest;
  results.replaceChildren();
  locationMessage.textContent = '検索しています…';
  try {
    let candidates = [];
    try {
      const url = new URL('https://msearch.gsi.go.jp/address-search/AddressSearch');
      url.searchParams.set('q', query);
      const response = await fetchJson(url);
      if (!Array.isArray(response)) throw new Error('検索結果の形式が不正です');
      candidates = response.map(item => ({
        name: item.properties?.title,
        longitude: item.geometry?.coordinates?.[0],
        latitude: item.geometry?.coordinates?.[1]
      })).filter(validLocation);
    } catch (_) { /* Try the other search service. */ }
    if (id !== searchRequest) return;
    if (!candidates.length) {
      const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
      url.search = new URLSearchParams({ name: query, language: 'ja', count: '10', format: 'json' });
      const response = await fetchJson(url);
      if (id !== searchRequest) return;
      candidates = (response.results || []).filter(validLocation).map(item => ({
        name: [item.name, item.admin1, item.country].filter(Boolean).join('、'),
        latitude: item.latitude,
        longitude: item.longitude
      }));
    }
    locationMessage.textContent = candidates.length ? '候補を選んでください。' : '候補が見つかりませんでした。';
    for (const item of candidates) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = item.name;
      button.addEventListener('click', () => saveLocation(item));
      const li = document.createElement('li'); li.append(button); results.append(li);
    }
  } catch (_) { if (id === searchRequest) locationMessage.textContent = '検索できませんでした。時間をおいてお試しください。'; }
});
document.querySelector('#use-location').addEventListener('click', () => {
  if (!navigator.geolocation) { locationMessage.textContent = '現在地を利用できません。'; return; }
  const id = ++locationRequest;
  locationMessage.textContent = '現在地を確認しています…';
  navigator.geolocation.getCurrentPosition(position => {
    if (id !== locationRequest) return;
    saveLocation({ name: '現在地', latitude: position.coords.latitude, longitude: position.coords.longitude });
  }, () => { if (id === locationRequest) locationMessage.textContent = '現在地を取得できませんでした。'; });
});
document.querySelector('#reset-location').addEventListener('click', () => {
  ++locationRequest;
  ++searchRequest;
  try {
    localStorage.removeItem(LOCATION_KEY);
    results.replaceChildren();
    locationMessage.textContent = '初期設定に戻しました。';
    updateStatus(DEFAULT_LOCATION, null);
    refreshWeather();
  } catch (_) { locationMessage.textContent = '設定をリセットできませんでした。'; }
});
