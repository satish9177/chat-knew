import { performance } from 'node:perf_hooks';
import type { Config } from './config.js';
import { IncidentEngine } from './engine/incidents.js';
import { ChatPipeline } from './pipeline.js';
import { getScenario, scenarios } from './simulator/scenarios.js';
import { ScenarioReplay } from './simulator/replay.js';
import type { AppView, OverlayView } from './types.js';

export class Application {
  engine: IncidentEngine;
  private pipeline: ChatPipeline;
  private replay: ScenarioReplay | null = null;
  private playing = false;
  private lastWallAt = performance.now();
  private preview: { overlay: OverlayView; until: number } | null = null;

  constructor(readonly config: Config, readonly simulation: boolean) {
    this.engine = new IncidentEngine(config);
    this.pipeline = new ChatPipeline(this.engine, config);
    if (simulation) this.select('obs-mute');
  }

  private select(id: string): void {
    const scenario = getScenario(id);
    this.engine = new IncidentEngine(this.config);
    this.pipeline = new ChatPipeline(this.engine, this.config);
    this.replay = new ScenarioReplay(scenario, {
      telemetry: (frame) => this.engine.observe(frame),
      chat: (message) => this.pipeline.chat(message),
      tick: (at) => this.engine.tick(at),
      acknowledge: (at) => this.engine.acknowledge(at),
    }, this.config.bucketMs);
    // Process genuine warm-up frames rather than making the viewer wait 24 seconds.
    this.replay.advanceTo(24_000);
    this.playing = false;
    this.preview = null;
    this.lastWallAt = performance.now();
  }

  update(): void {
    const wallAt = performance.now();
    if (this.replay && this.playing) {
      this.replay.advanceBy(wallAt - this.lastWallAt);
      if (this.replay.finished) this.playing = false;
    }
    this.lastWallAt = wallAt;
    if (this.preview && wallAt >= this.preview.until) this.preview = null;
  }

  control(action: string, scenarioId?: string): void {
    this.update();
    if (action === 'acknowledge') this.engine.acknowledge();
    else if (action === 'toggle-alerts') this.engine.toggleAlerts();
    else if (action === 'preview') {
      this.preview = {
        overlay: { id: `preview-${performance.now()}`, kind: 'thanks', title: 'CHAT KNEW', detail: 'Muted for 0:42 · 7 of you tried to tell me · First: @Preview', phase: 'stamp', startedAt: this.engine.now, expiresAt: this.engine.now + 6000 },
        until: performance.now() + 6000,
      };
    } else {
      if (!this.simulation || !this.replay) throw new Error('Replay controls are available only in simulation mode');
      if (action === 'select') this.select(scenarioId ?? '');
      else if (action === 'restart') this.select(this.replay.scenario.id);
      else if (action === 'play') { if (this.replay.finished) this.select(this.replay.scenario.id); this.playing = true; }
      else if (action === 'pause-replay') this.playing = false;
      else if (action === 'step') { this.playing = false; this.replay.advanceBy(5000); }
      else throw new Error('Unknown action');
    }
    this.lastWallAt = performance.now();
  }

  snapshot(): AppView {
    const state = this.engine.snapshot();
    return {
      ...state,
      overlay: this.preview?.overlay ?? state.overlay,
      mode: this.simulation ? 'simulation' : 'offline',
      status: {
        obs: this.simulation ? 'Simulated telemetry' : 'Not connected · M2 adapter pending',
        twitch: this.simulation ? 'Synthetic viewers' : 'Not connected · M2 adapter pending',
        classifier: 'Keyword fallback · no API calls',
        privateAudio: 'Visual only · private audio is not connected',
      },
      scenario: this.replay ? { id: this.replay.scenario.id, title: this.replay.scenario.title, description: this.replay.scenario.description, durationMs: this.replay.scenario.durationMs, positionMs: this.replay.positionMs, playing: this.playing } : null,
      scenarios: scenarios.map(({ id, title, description, durationMs }) => ({ id, title, description, durationMs })),
    };
  }

  overlayPacket(): object {
    const state = this.snapshot();
    return { type: 'overlay', overlay: state.overlay, mode: this.preview ? 'simulation' : state.mode, now: state.now, playing: state.scenario?.playing ?? false };
  }
}
