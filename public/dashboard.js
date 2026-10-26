'use strict';
(() => {
  const token = new URLSearchParams(location.search).get('token') || '';
  const ui = Object.fromEntries(Array.from(document.querySelectorAll('[id]'), (element) => [element.id, element]));
  let current = null;
  let socket = null;
  let retry = 750;
  let timelineKey = '';
  let scenariosKey = '';
  let connected = false;
  let busy = false;
  const formatTime = (value) => {
    const seconds = Math.max(0, Math.floor(Number(value || 0) / 1000));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  };
  function text(id, value) { ui[id].textContent = value; }
  function setNotice(message, error = false) { text('notice', message); ui.notice.classList.toggle('error', error); }
  function setConnection(ok) {
    connected = ok;
    text('connection-text', ok ? 'Local app connected' : 'Reconnecting…');
    ui.connection.querySelector('.status-dot').className = `status-dot ${ok ? 'good' : 'warning'}`;
    if (!ok) setNotice('Connection lost. Reconnecting to the local app…', true);
    updateControls();
  }
  function updateControls() {
    const enabled = connected && !busy;
    ['toggle-alerts', 'preview-button'].forEach((id) => { ui[id].disabled = !enabled; });
    ['scenario-select', 'play-replay', 'restart-replay', 'step-replay'].forEach((id) => { ui[id].disabled = !enabled || current?.mode !== 'simulation'; });
    ui.acknowledge.disabled = !enabled || Boolean(current?.incident?.acknowledged);
  }
  function status(id, label) {
    text(`${id}-status`, label);
    const lower = String(label).toLowerCase();
    const bad = /unavailable|disconnected|not connected|not ready|missing|unverified|not implemented/.test(lower);
    ui[`${id}-dot`].className = `status-dot ${bad ? 'warning' : 'good'}`;
  }
  function renderIncident(state) {
    const incident = state.incident;
    const active = incident && incident.state !== 'closed';
    const warning = active && ['confirmed', 'recovering', 'unsure'].includes(incident.state);
    ui['incident-panel'].classList.toggle('warning', Boolean(warning));
    ui['incident-meta'].hidden = !active;
    ui.acknowledge.hidden = !active;
    ui['acknowledge-note'].hidden = !active;
    if (!active) {
      const gathering = Math.max(state.consensus.audio, state.consensus.away) > 0;
      text('incident-heading', state.paused ? 'Alerts are taking a break.' : gathering ? 'Chat is raising a hand.' : 'Ready when chat knows.');
      text('incident-reason', state.paused ? 'Evidence keeps running. Resume when you are ready.' : gathering ? 'Waiting for a few more distinct viewers before checking.' : 'Three matching voices are enough to start checking.');
      text('incident-symbol', state.paused ? 'Ⅱ' : gathering ? '…' : '✓');
      ui['incident-status'].replaceChildren(Object.assign(document.createElement('span'), { className: 'status-dot' }), document.createTextNode(state.paused ? 'Paused' : gathering ? 'Gathering' : 'Watching'));
      return;
    }
    const titles = { mute: 'Chat caught the mute.', silence: 'Your mic went quiet.', away: 'Still on the away scene.', unsure: 'Chat reports a problem.' };
    const labels = { confirmed: 'Confirmed locally', recovering: 'Checking recovery', grace: 'Fixed · late reports welcome', unsure: 'Needs a look', closed: 'Resolved' };
    text('incident-heading', incident.state === 'grace' ? 'Chat knew. You fixed it.' : titles[incident.kind] || 'Chat raised a report.');
    text('incident-reason', incident.reason || 'Checking available local evidence.');
    text('incident-symbol', incident.state === 'grace' ? '✓' : incident.state === 'unsure' ? '?' : '!');
    ui['incident-status'].replaceChildren(Object.assign(document.createElement('span'), { className: 'status-dot' }), document.createTextNode(labels[incident.state] || incident.state));
    text('incident-reporters', `${incident.reporterCount} distinct reporters`);
    text('incident-pings', `${incident.pingCount}/4 private pings${state.mode === 'simulation' ? ' · simulated' : ''}`);
    text('incident-clock', incident.graceEndsAt != null ? `${formatTime(incident.graceEndsAt - state.now)} grace left` : `${formatTime(state.now - incident.confirmedAt)} since confirmation`);
    ui.acknowledge.replaceChildren(document.createTextNode(incident.acknowledged ? 'Acknowledged ✓' : 'I know  ✓'));
    text('acknowledge-note', incident.acknowledged ? 'Repeat pings and the public stamp are suppressed for this incident.' : 'Stops repeat pings and skips this incident\'s public stamp.');
  }
  function renderTimeline(entries) {
    const key = JSON.stringify(entries);
    if (key === timelineKey) return;
    timelineKey = key;
    const list = ui.timeline;
    list.replaceChildren();
    if (!entries.length) {
      const empty = document.createElement('li');
      empty.className = 'timeline-empty';
      empty.textContent = 'The story of your stream will show up here.';
      const sub = document.createElement('span');
      sub.textContent = 'Only incident summaries. No saved chat.';
      empty.append(document.createElement('br'), sub);
      list.append(empty);
      return;
    }
    [...entries].sort((a, b) => b.at - a.at).forEach((entry) => {
      const item = document.createElement('li');
      item.className = ['good', 'warning'].includes(entry.tone) ? entry.tone : 'info';
      const time = document.createElement('span'); time.className = 'timeline-time'; time.textContent = formatTime(entry.at);
      const title = document.createElement('strong'); title.className = 'timeline-title'; title.textContent = entry.label;
      const detail = document.createElement('span'); detail.className = 'timeline-detail'; detail.textContent = entry.detail;
      item.append(time, title, detail); list.append(item);
    });
  }
  function render(state) {
    current = state;
    text('mode-tag', state.mode === 'simulation' ? 'SIMULATION' : 'OFFLINE');
    status('obs', state.status.obs); status('twitch', state.status.twitch); status('classifier', state.status.classifier); status('audio', state.status.privateAudio);
    setNotice(state.mode === 'simulation' ? 'Rehearsal mode · all chat, telemetry and private pings are simulated. No credentials or external calls.' : 'M1 is a local rehearsal. Live Twitch, OBS and OpenAI adapters are not connected yet.');
    if (state.paused) setNotice('Alerts are paused. Evidence keeps running; public graphics and private pings are suppressed.');
    const frame = state.telemetry;
    const db = frame?.micDb;
    const knownMeter = frame?.connected && frame?.meterFresh && typeof db === 'number';
    const finite = knownMeter && Number.isFinite(db);
    text('mic-db', !knownMeter ? '—' : finite ? Math.round(db).toString() : '−∞');
    ui['mic-level'].style.width = `${knownMeter ? Math.max(0, Math.min(100, ((Number.isFinite(db) ? db : -60) + 60) / 60 * 100)) : 0}%`;
    ui['mic-meter'].setAttribute('aria-valuenow', String(finite ? Math.max(-60, Math.min(0, db)) : -60));
    ui['mic-meter'].classList.toggle('muted', frame?.micMuted === true);
    text('mic-state', frame?.micMuted === true ? 'MUTED' : frame?.micMuted === false ? 'UNMUTED' : 'UNKNOWN');
    ui['mic-state'].className = `small-tag${frame?.micMuted === true ? ' bad' : frame?.micMuted === false ? ' mint' : ''}`;
    text('mic-route', frame?.globalMic === true ? 'Global Mic/Aux · local evidence' : frame?.globalMic === false ? 'Warning: selected mic is not global Mic/Aux' : 'Global microphone not verified');
    text('scene-name', frame?.scene || '—');
    text('stream-state', frame?.streaming === true ? 'Stream active' : frame?.streaming === false ? 'Stream offline' : 'Stream state unknown');
    const count = Math.max(state.consensus.audio, state.consensus.away);
    text('consensus-count', count); text('consensus-required', state.consensus.required);
    text('consensus-detail', count ? `${state.consensus.audio} audio · ${state.consensus.away} away-scene reports` : 'Waiting for matching reports');
    if (ui['consensus-dots'].children.length !== state.consensus.required) ui['consensus-dots'].replaceChildren(...Array.from({ length: state.consensus.required }, () => document.createElement('i')));
    Array.from(ui['consensus-dots'].children).forEach((dot, index) => dot.classList.toggle('filled', index < count));
    text('wolf-count', `${state.wolfCount} ${state.wolfCount === 1 ? 'WOLF' : 'WOLVES'}`);
    text('toggle-alerts', state.paused ? 'Resume alerts' : 'Pause alerts');
    renderIncident(state); renderTimeline(state.timeline || []);
    const overlay = state.overlay && state.overlay.expiresAt > state.now ? state.overlay : null;
    ui['preview-empty'].hidden = Boolean(overlay); ui['preview-stamp'].hidden = !overlay;
    ui['preview-sim'].hidden = state.mode !== 'simulation';
    if (overlay) { text('preview-title', overlay.title); text('preview-detail', overlay.detail); ui['preview-stamp'].className = `preview-stamp ${overlay.kind === 'wolf' ? 'wolf' : ''} ${overlay.phase === 'badge' ? 'badge' : ''}`; }
    const choices = JSON.stringify(state.scenarios);
    if (choices !== scenariosKey) {
      scenariosKey = choices;
      ui['scenario-select'].replaceChildren(...state.scenarios.map((scenario) => {
        const option = document.createElement('option'); option.value = scenario.id; option.textContent = scenario.title; return option;
      }));
    }
    const scenario = state.scenario;
    if (scenario) ui['scenario-select'].value = scenario.id;
    text('scenario-description', scenario?.description || 'Start with npm run simulate to run scenarios without credentials.');
    text('replay-position', formatTime(scenario?.positionMs)); text('replay-duration', formatTime(scenario?.durationMs));
    const progress = scenario ? Math.max(0, Math.min(100, scenario.positionMs / scenario.durationMs * 100)) : 0;
    ui['replay-fill'].style.width = `${progress}%`; ui['replay-progress'].setAttribute('aria-valuenow', String(Math.round(progress)));
    text('play-replay', scenario?.playing ? 'Pause replay' : scenario && scenario.positionMs >= scenario.durationMs ? 'Replay again' : 'Play scenario');
    updateControls();
  }
  async function fetchState() {
    const response = await fetch(`/api/state?token=${encodeURIComponent(token)}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'Use the complete dashboard URL printed by the app, including its token.' : 'Could not load local state.');
    render(await response.json());
  }
  async function control(action, extra = {}) {
    if (busy || !connected) return;
    busy = true; updateControls();
    try {
      const response = await fetch(`/api/control?token=${encodeURIComponent(token)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...extra }) });
      if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error || 'The local app could not complete that action.'); }
      const result = await response.json(); if (result && result.status && result.consensus) render(result); else await fetchState();
    } catch (error) { setNotice(error.message || 'Control failed.', true); }
    finally { busy = false; updateControls(); }
  }
  function connect() {
    const url = new URL('/ws', location.href); url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'; url.searchParams.set('token', token); url.searchParams.set('view', 'dashboard');
    socket = new WebSocket(url);
    socket.addEventListener('open', () => { retry = 750; setConnection(true); fetchState().catch((error) => setNotice(error.message, true)); });
    socket.addEventListener('message', (event) => { try { const message = JSON.parse(event.data); if (message.type === 'state' && message.state) render(message.state); } catch { setNotice('Received an unreadable local update. Reconnecting…', true); socket.close(); } });
    socket.addEventListener('close', () => { setConnection(false); setTimeout(connect, retry); retry = Math.min(10_000, Math.round(retry * 1.6)); });
    socket.addEventListener('error', () => socket.close());
  }
  ui['overlay-link'].href = `/overlay?token=${encodeURIComponent(token)}`;
  ui['toggle-alerts'].addEventListener('click', () => control('toggle-alerts'));
  ui.acknowledge.addEventListener('click', () => control('acknowledge'));
  ui['preview-button'].addEventListener('click', () => control('preview'));
  ui['scenario-select'].addEventListener('change', () => control('select', { scenarioId: ui['scenario-select'].value }));
  ui['play-replay'].addEventListener('click', () => control(current?.scenario?.playing ? 'pause-replay' : 'play'));
  ui['restart-replay'].addEventListener('click', () => control('restart'));
  ui['step-replay'].addEventListener('click', () => control('step'));
  if (!token) setNotice('Open the complete dashboard URL printed by the app, including its local token.', true);
  else connect();
})();
