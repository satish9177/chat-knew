export type Claim = 'AUDIO_MISSING' | 'AWAY_SCENE';
export type IncidentKind = 'mute' | 'silence' | 'away' | 'unsure';

export interface ChatMessage {
  id: string;
  userId: string;
  displayName: string;
  text: string;
  at: number;
  sourceBroadcasterId?: string | null;
}

/** One 250 ms evidence bucket; null/meterFresh=false means unknown, never silence. */
export interface TelemetryFrame {
  at: number;
  epoch: number;
  connected: boolean;
  streaming: boolean | null;
  micMuted: boolean | null;
  micDb: number | null;
  meterFresh: boolean;
  globalMic: boolean | null;
  faderDb: number | null;
  monitorAllowsOutput: boolean | null;
  scene: string | null;
  transitioning?: boolean;
}

export interface IncidentView {
  id: string;
  claim: Claim;
  kind: IncidentKind;
  state: 'confirmed' | 'recovering' | 'grace' | 'closed' | 'unsure';
  reporterCount: number;
  firstReporter: string;
  startedAt: number;
  confirmedAt: number;
  recoveredAt: number | null;
  graceEndsAt: number | null;
  acknowledged: boolean;
  pingCount: number;
  reason: string;
  onsetBeforeHistory: boolean;
}

export interface OverlayView {
  id: string;
  kind: 'thanks' | 'wolf';
  title: string;
  detail: string;
  phase: 'stamp' | 'badge';
  startedAt: number;
  expiresAt: number;
  reporterCount?: number;
  firstReporter?: string;
}

export interface TimelineEntry {
  id: string;
  at: number;
  label: string;
  detail: string;
  tone: 'info' | 'good' | 'warning';
}

export interface EngineEvent {
  type: 'ping' | 'confirmed' | 'recovered' | 'wolf' | 'acknowledged';
  at: number;
  incidentId: string;
}

export interface EngineView {
  now: number;
  telemetry: TelemetryFrame | null;
  consensus: { audio: number; away: number; required: number };
  incident: IncidentView | null;
  timeline: TimelineEntry[];
  overlay: OverlayView | null;
  wolfCount: number;
  paused: boolean;
}

export interface ScenarioInfo {
  id: string;
  title: string;
  description: string;
  durationMs: number;
}

export interface AppView extends EngineView {
  mode: 'simulation' | 'offline';
  status: { obs: string; twitch: string; classifier: string; privateAudio: string };
  scenario: (ScenarioInfo & { positionMs: number; playing: boolean }) | null;
  scenarios: ScenarioInfo[];
}

export interface Scenario extends ScenarioInfo {
  frameAt: (at: number) => Omit<TelemetryFrame, 'at' | 'epoch'>;
  messages: ChatMessage[];
  acknowledgements?: number[];
  expected: 'mute' | 'silence' | 'away' | 'wolf';
}

export interface ReplaySink {
  telemetry: (frame: TelemetryFrame) => void;
  chat: (message: ChatMessage) => void;
  tick: (at: number) => void;
  acknowledge: (at: number) => void;
}
