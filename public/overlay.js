'use strict';
(() => {
  const token = new URLSearchParams(location.search).get('token') || '';
  const canvas = document.querySelector('.canvas');
  const stamp = document.getElementById('stamp');
  const title = document.getElementById('stamp-title');
  const detail = document.getElementById('stamp-detail');
  const mark = document.getElementById('stamp-mark');
  const simulation = document.getElementById('simulation-tag');
  let current = null;
  let previousNow = null;
  let receivedNow = 0;
  let receivedAt = performance.now();
  let clockRunning = true;
  let retry = 750;
  let mode = 'offline';
  function resize() { canvas.style.transform = `scale(${Math.min(innerWidth / 1920, innerHeight / 1080)})`; }
  function estimatedNow() { return receivedNow + (clockRunning ? performance.now() - receivedAt : 0); }
  function hide() { stamp.hidden = true; stamp.classList.remove('enter'); current = null; }
  function render(packet) {
    mode = packet.mode || 'offline';
    const now = Number(packet.now || 0);
    clockRunning = mode !== 'simulation' || (typeof packet.playing === 'boolean' ? packet.playing : previousNow === null || now > previousNow);
    previousNow = now; receivedNow = now; receivedAt = performance.now();
    simulation.hidden = mode !== 'simulation';
    const overlay = packet.overlay;
    if (!overlay || overlay.expiresAt <= now) { hide(); return; }
    const isNew = current?.id !== overlay.id;
    current = overlay;
    title.textContent = overlay.title;
    detail.textContent = overlay.detail;
    mark.textContent = overlay.kind === 'wolf' ? '?' : '✓';
    stamp.classList.toggle('wolf', overlay.kind === 'wolf');
    stamp.classList.toggle('badge', overlay.phase === 'badge');
    stamp.hidden = false;
    if (isNew) { stamp.classList.remove('enter'); void stamp.offsetWidth; stamp.classList.add('enter'); }
  }
  async function fetchState() {
    const response = await fetch(`/api/state?token=${encodeURIComponent(token)}`, { cache: 'no-store' });
    if (!response.ok) { hide(); return; }
    const state = await response.json(); render({ overlay: state.overlay, mode: state.mode, now: state.now, playing: state.scenario?.playing });
  }
  function connect() {
    const url = new URL('/ws', location.href); url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'; url.searchParams.set('token', token); url.searchParams.set('view', 'overlay');
    const socket = new WebSocket(url);
    socket.addEventListener('open', () => { retry = 750; previousNow = null; fetchState().catch(hide); });
    socket.addEventListener('message', (event) => { try { const packet = JSON.parse(event.data); if (packet.type === 'overlay') render(packet); } catch { hide(); } });
    socket.addEventListener('close', () => { clockRunning = true; setTimeout(connect, retry); retry = Math.min(10_000, Math.round(retry * 1.6)); });
    socket.addEventListener('error', () => socket.close());
  }
  setInterval(() => { if (current && estimatedNow() >= current.expiresAt) hide(); }, 150);
  window.addEventListener('resize', resize); resize();
  if (token) connect();
})();
