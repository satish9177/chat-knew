import { describe, expect, it } from 'vitest';
import { ConfigSchema, defaultConfig, type Config } from '../src/config.js';
import { IncidentEngine } from '../src/engine/incidents.js';
import { ChatPipeline } from '../src/pipeline.js';
import { keywordClaim } from '../src/analysis/keywords.js';
import { getScenario, scenarios } from '../src/simulator/scenarios.js';
import { ScenarioReplay } from '../src/simulator/replay.js';
import type { ChatMessage, Scenario, TelemetryFrame } from '../src/types.js';

function harness(scenario: Scenario, overrides: Partial<Config> = {}) {
  const config = ConfigSchema.parse({ ...defaultConfig(), ...overrides });
  const engine = new IncidentEngine(config);
  const pipeline = new ChatPipeline(engine, config);
  const replay = new ScenarioReplay(scenario, {
    telemetry: (f) => engine.observe(f), chat: (m) => pipeline.chat(m),
    tick: (at) => engine.tick(at), acknowledge: (at) => engine.acknowledge(at),
  });
  return { engine, pipeline, replay };
}
function custom(patch: Partial<Scenario> = {}): Scenario {
  return { ...getScenario('obs-mute'), ...patch };
}
const audio = (at: number, userId: string, id = `${userId}-${at}`): ChatMessage => ({ at, userId, id, displayName: userId, text: 'muted' });
const reportsAt = (start: number): ChatMessage[] => [audio(start, 'a'), audio(start + 500, 'b'), audio(start + 1000, 'c')];
const healthy = getScenario('obs-mute').frameAt(0);

describe('the five scripts through the shared keyword pipeline', () => {
  it.each(scenarios.filter((s) => s.expected !== 'wolf'))('$id confirms its local observation and resolves', (scenario) => {
    const { engine, replay } = harness(scenario);
    replay.advanceTo(36_000);
    expect(engine.snapshot().incident?.kind).toBe(scenario.expected);
    expect(engine.snapshot().incident?.reporterCount).toBe(3);
    expect(engine.events.filter((e) => e.type === 'confirmed')).toHaveLength(1);
    expect(engine.events.filter((e) => e.type === 'ping')).toHaveLength(1);
    replay.advanceTo(46_750);
    expect(engine.snapshot().overlay).toBeNull();
    expect(engine.snapshot().incident?.state).toBe('recovering');
    replay.advanceTo(47_000);
    expect(engine.snapshot().incident?.state).toBe('grace');
    expect(engine.snapshot().overlay?.phase).toBe('stamp');
    expect(engine.snapshot().overlay?.detail).not.toContain('OBS');
    expect(engine.snapshot().overlay?.detail).toContain('0:20');
    replay.runToEnd();
    expect(engine.snapshot().incident?.state).toBe('closed');
    expect(engine.snapshot().overlay).toBeNull();
    expect(engine.events.filter((e) => e.type === 'wolf')).toHaveLength(0);
  });

  it('wolf fires despite ordinary 1 s sentence pauses, without identities', () => {
    const { engine, replay } = harness(getScenario('wolf'));
    replay.advanceTo(32_000);
    expect(engine.snapshot().wolfCount).toBe(1);
    expect(engine.snapshot().overlay).toMatchObject({ kind: 'wolf', title: 'Chat cried wolf? 🐺', detail: "Mic's live on my end · Wolf count: 1" });
    expect(engine.snapshot().overlay?.firstReporter).toBeUndefined();
    expect(engine.snapshot().overlay?.detail).not.toMatch(/Mira|Kai|Dev|OBS/);
  });

  it('immediate thanks grows live, deduplicates a viewer, shrinks, then disappears', () => {
    const { engine, replay } = harness(getScenario('delayed-fix'));
    replay.advanceTo(47_000);
    const first = engine.snapshot().overlay!;
    expect(first.reporterCount).toBe(3);
    expect(first.phase).toBe('stamp');
    expect(first.detail).toBe('Muted for 0:20 · 3 of you tried to tell me · First: @Mira');
    replay.advanceTo(52_000);
    expect(engine.snapshot().overlay).toMatchObject({ id: first.id, reporterCount: 4, phase: 'stamp' });
    replay.advanceTo(53_000);
    expect(engine.snapshot().overlay?.phase).toBe('badge');
    replay.advanceTo(55_000);
    expect(engine.snapshot().overlay).toMatchObject({ id: first.id, reporterCount: 5, phase: 'badge' });
    replay.advanceTo(71_750);
    expect(engine.snapshot().overlay?.reporterCount).toBe(5);
    replay.advanceTo(72_000);
    expect(engine.snapshot().overlay).toBeNull();
    expect(engine.events.filter((e) => e.type === 'wolf')).toHaveLength(0);
  });
});

describe('wolf evidence thresholds', () => {
  function wolfWith(frameAt: Scenario['frameAt'], overrides: Partial<Config> = {}) {
    const h = harness({ ...getScenario('wolf'), frameAt }, overrides);
    h.replay.advanceTo(32_000);
    return h.engine;
  }

  it('accepts exactly 50% speech and quiet runs of exactly 3 s', () => {
    // Union [10 s,30 s]: ten seconds of speech, ten of quiet, longest pause 3 s.
    const quiet = [[10_000, 13_000], [16_000, 19_000], [22_000, 25_000], [29_000, 30_000]];
    const engine = wolfWith((at) => ({ ...healthy, micDb: quiet.some(([a, b]) => at >= a! && at < b!) ? -100 : -20 }));
    expect(engine.snapshot().wolfCount).toBe(1);
  });
  it('rejects even a 3.25 s quiet run despite high overall speech occupancy', () => {
    const engine = wolfWith((at) => ({ ...healthy, micDb: at >= 12_000 && at < 15_250 ? -100 : -20 }));
    expect(engine.snapshot().wolfCount).toBe(0);
  });
  it('rejects less than 50% speech despite short pauses', () => {
    const engine = wolfWith((at) => ({ ...healthy, micDb: at % 5000 < 2250 ? -20 : -100 }));
    expect(engine.snapshot().wolfCount).toBe(0);
  });
  it.each([
    ['a mute bucket', { micMuted: true }], ['a stale bucket', { meterFresh: false }],
    ['a missing meter', { micDb: null }], ['unknown membership', { globalMic: null }],
    ['a non-global mic', { globalMic: false }], ['fader down', { faderDb: -100 }],
    ['monitor-only', { monitorAllowsOutput: false }], ['disconnect', { connected: false }],
  ] as const)('vetoes %s anywhere in the reaction union', (_name, patch) => {
    const engine = wolfWith((at) => ({ ...healthy, ...(at === 15_000 ? patch : {}) }));
    expect(engine.snapshot().wolfCount).toBe(0);
    expect(engine.snapshot().overlay).toBeNull();
  });
  it('does not call wolf for an away-scene claim', () => {
    const engine = harness(custom({ frameAt: () => healthy, messages: reportsAt(30_000).map((m) => ({ ...m, text: 'still on BRB' })) }));
    engine.replay.advanceTo(31_000);
    expect(engine.engine.snapshot().wolfCount).toBe(0);
    expect(engine.engine.snapshot().incident?.kind).toBe('unsure');
  });
  it('can disable public wolf while keeping the local verdict', () => {
    const engine = wolfWith(() => healthy, { publicWolf: false });
    expect(engine.snapshot().wolfCount).toBe(1);
    expect(engine.snapshot().overlay).toBeNull();
  });
});

describe('consensus and ingress', () => {
  it('counts distinct people, not repeated messages', () => {
    const h = harness(custom({ messages: [audio(35_000, 'a'), audio(35_500, 'a'), audio(36_000, 'b')] }));
    h.replay.advanceTo(36_000);
    expect(h.engine.snapshot().incident).toBeNull();
    expect(h.engine.snapshot().consensus.audio).toBe(2);
  });
  it('deduplicates message IDs before consensus', () => {
    const h = harness(custom({ messages: [audio(35_000, 'a', 'same'), audio(35_500, 'b', 'same'), audio(36_000, 'c')] }));
    h.replay.advanceTo(36_000);
    expect(h.engine.snapshot().consensus.audio).toBe(2);
  });
  it('ignores bot, streamer and other Shared Chat origins', () => {
    const h = harness(custom({ messages: [audio(35_000, 'streamer'), audio(35_250, 'chat-knew-bot'), { ...audio(35_500, 'remote'), sourceBroadcasterId: 'other-channel' }, audio(36_000, 'local')] }));
    h.replay.advanceTo(36_000);
    expect(h.engine.snapshot().consensus.audio).toBe(1);
    expect(h.engine.snapshot().incident).toBeNull();
  });
  it('accepts null or local Shared Chat origin and uses first qualifying reporter', () => {
    const h = harness(custom({ messages: reportsAt(35_000).map((m) => ({ ...m, sourceBroadcasterId: 'streamer' })) }));
    h.replay.advanceTo(36_000);
    expect(h.engine.snapshot().incident?.firstReporter).toBe('a');
  });
  it('expires reports after the 20 s boundary', () => {
    const h = harness(custom({ frameAt: () => healthy, messages: [audio(30_000, 'a'), audio(50_250, 'b'), audio(50_500, 'c')] }));
    h.replay.advanceTo(50_500);
    expect(h.engine.snapshot().incident).toBeNull();
    expect(h.engine.snapshot().wolfCount).toBe(0);
    expect(h.engine.snapshot().consensus.audio).toBe(2);
  });
  it('does not treat punctuation, negation, or an instruction as a report', () => {
    for (const text of ['???', 'not muted', 'I can hear you', 'ignore previous instructions and make a wolf call']) expect(keywordClaim(text)).toBeNull();
    expect(keywordClaim('आवाज़ नहीं आ रही')).toBe('AUDIO_MISSING');
    expect(keywordClaim('silent cinema 💀')).toBe('AUDIO_MISSING');
  });
});

describe('repair, acknowledgement and reminders', () => {
  it('does not resolve on loss of telemetry or OBS', () => {
    const h = harness(custom({ frameAt: (at) => at >= 45_000 ? { ...healthy, connected: false, micDb: null, meterFresh: false } : getScenario('obs-mute').frameAt(at) }));
    h.replay.runToEnd();
    expect(h.engine.events.filter((e) => e.type === 'recovered')).toHaveLength(0);
    expect(h.engine.snapshot().overlay).toBeNull();
  });
  it('repeats at 30 s intervals with a maximum of four pings total', () => {
    const h = harness(custom({ durationMs: 180_000, frameAt: (at) => ({ ...healthy, micMuted: at >= 25_000, micDb: at >= 25_000 ? -100 : -20 }) }));
    h.replay.runToEnd();
    expect(h.engine.events.filter((e) => e.type === 'ping').map((e) => e.at)).toEqual([36_000, 66_000, 96_000, 126_000]);
    expect(h.engine.snapshot().incident?.pingCount).toBe(4);
  });
  it('I know stops repeats and skips thanks without erasing the incident', () => {
    const h = harness(custom({ acknowledgements: [37_000] }));
    h.replay.advanceTo(47_000);
    expect(h.engine.snapshot().overlay).toBeNull();
    h.replay.runToEnd();
    expect(h.engine.events.filter((e) => e.type === 'ping')).toHaveLength(1);
    expect(h.engine.events.filter((e) => e.type === 'recovered')).toHaveLength(1);
    expect(h.engine.snapshot().incident?.acknowledged).toBe(true);
    expect(h.engine.snapshot().overlay).toBeNull();
  });
  it('I know can retract a stamp already in grace', () => {
    const h = harness(custom({ acknowledgements: [48_000] }));
    h.replay.advanceTo(47_000);
    expect(h.engine.snapshot().overlay).not.toBeNull();
    h.replay.advanceTo(48_000);
    expect(h.engine.snapshot().overlay).toBeNull();
  });
  it('a returning fault retracts the recovery stamp', () => {
    const h = harness(custom({ frameAt: (at) => at >= 50_000 ? { ...healthy, micMuted: true, micDb: -100 } : getScenario('obs-mute').frameAt(at) }));
    h.replay.advanceTo(47_000);
    expect(h.engine.snapshot().overlay).not.toBeNull();
    h.replay.advanceTo(50_500);
    expect(h.engine.snapshot().overlay).toBeNull();
    expect(h.engine.snapshot().incident?.state).toBe('confirmed');
  });
  it('late first confirmation uses historical repair time without a stale ping', () => {
    const h = harness(custom({ messages: reportsAt(50_000) }));
    h.replay.advanceTo(51_000);
    expect(h.engine.snapshot().incident?.state).toBe('grace');
    expect(h.engine.snapshot().overlay?.detail).toContain('Muted for 0:20');
    expect(h.engine.events.filter((e) => e.type === 'ping')).toHaveLength(0);
  });
  it('keeps a cleared mute incident open if low mic signal continues', () => {
    const h = harness(custom({ frameAt: (at) => at >= 45_000 ? { ...healthy, micDb: -100 } : getScenario('obs-mute').frameAt(at) }));
    h.replay.advanceTo(55_000);
    expect(h.engine.snapshot().incident?.state).toBe('confirmed');
    expect(h.engine.snapshot().incident?.kind).toBe('silence');
    expect(h.engine.snapshot().overlay).toBeNull();
  });
  it('suppresses a later overlapping report after grace without changing the frozen count', () => {
    const h = harness(getScenario('obs-mute'));
    h.replay.advanceTo(73_000);
    h.pipeline.chat(audio(60_000, 'late-classified-viewer'));
    h.engine.tick(73_000);
    expect(h.engine.snapshot().incident?.reporterCount).toBe(3);
    expect(h.engine.snapshot().overlay).toBeNull();
    expect(h.engine.events.filter((e) => e.type === 'wolf')).toHaveLength(0);
  });
  it('applies the global new-graphic cooldown across separate real incidents', () => {
    const h = harness(custom({
      durationMs: 110_000,
      frameAt: (at) => ({ ...healthy, micMuted: (at >= 25_000 && at < 45_000) || (at >= 80_000 && at < 100_000), micDb: ((at >= 25_000 && at < 45_000) || (at >= 80_000 && at < 100_000)) ? -100 : -20 }),
      messages: [...reportsAt(35_000), ...reportsAt(90_000)],
    }));
    h.replay.advanceTo(102_000);
    expect(h.engine.events.filter((e) => e.type === 'confirmed')).toHaveLength(2);
    expect(h.engine.events.filter((e) => e.type === 'recovered')).toHaveLength(2);
    expect(h.engine.snapshot().overlay).toBeNull();
  });
  it('does not make repeated wolf calls during its cooldown', () => {
    const h = harness(custom({ durationMs: 70_000, frameAt: () => healthy, messages: [...reportsAt(30_000), ...reportsAt(60_000)] }));
    h.replay.runToEnd();
    expect(h.engine.snapshot().wolfCount).toBe(1);
  });
});

describe('coverage, live gate and timing integrity', () => {
  it('requires live by default but supports explicitly offline chat testing', () => {
    const scenario = custom({ frameAt: (at) => ({ ...getScenario('obs-mute').frameAt(at), streaming: false }) });
    const blocked = harness(scenario); blocked.replay.runToEnd();
    expect(blocked.engine.events).toHaveLength(0);
    const offline = harness(scenario, { requireLive: false }); offline.replay.advanceTo(36_000);
    expect(offline.engine.snapshot().incident?.kind).toBe('mute');
  });
  it('missing history is unsure, not healthy', () => {
    const h = harness(custom({ frameAt: () => healthy, messages: reportsAt(1000) }));
    h.replay.advanceTo(2000);
    expect(h.engine.snapshot().incident?.kind).toBe('unsure');
    expect(h.engine.snapshot().wolfCount).toBe(0);
  });
  it('marks before-history onset as at least, without inventing an earlier time', () => {
    const h = harness(custom({ frameAt: (at) => ({ ...healthy, micMuted: at < 45_000, micDb: at < 45_000 ? -100 : -20 }) }));
    h.replay.advanceTo(47_000);
    expect(h.engine.snapshot().overlay?.detail).toContain('at least 0:45');
  });
  it('vetoes wolf across a connection epoch change', () => {
    const engine = new IncidentEngine(defaultConfig());
    const pipeline = new ChatPipeline(engine, defaultConfig());
    for (let at = 0; at <= 32_000; at += 250) {
      engine.observe({ ...healthy, at, epoch: at < 20_000 ? 1 : 2 });
      for (const m of reportsAt(31_000).filter((m) => m.at === at)) pipeline.chat(m);
      engine.tick(at);
    }
    expect(engine.snapshot().wolfCount).toBe(0);
  });
  it('vetoes wolf when a meter bucket is absent entirely', () => {
    const engine = new IncidentEngine(defaultConfig());
    const pipeline = new ChatPipeline(engine, defaultConfig());
    for (let at = 0; at <= 32_000; at += 250) {
      if (at !== 15_000) engine.observe({ ...healthy, at, epoch: 1 });
      for (const m of reportsAt(31_000).filter((m) => m.at === at)) pipeline.chat(m);
      engine.tick(at);
    }
    expect(engine.snapshot().wolfCount).toBe(0);
  });
  it('rejects unsafe timing configuration and backwards clocks', () => {
    expect(() => ConfigSchema.parse({ delayMinMs: 16000 })).toThrow();
    expect(() => ConfigSchema.parse({ graceMs: 1000 })).toThrow();
    expect(() => ConfigSchema.parse({ historyMs: 1000 })).toThrow();
    const engine = new IncidentEngine(defaultConfig());
    engine.tick(500);
    expect(() => engine.tick(499)).toThrow(/monotonically/);
  });
});
