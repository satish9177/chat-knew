import type { Config } from '../config.js';
import type { ChatMessage, Claim, EngineEvent, EngineView, IncidentKind, IncidentView, OverlayView, TelemetryFrame, TimelineEntry } from '../types.js';
import { mergeIntervals, overlaps, StateHistory, type Interval } from './history.js';

interface Report extends Omit<ChatMessage, 'text'> { claim: Claim }
interface Incident extends IncidentView {
  reporters: Map<string, Report>;
  lastPingAt: number | null;
  recoveryShownAt: number | null;
  completedDurationMs: number;
  segmentStart: number;
  faultPeriods: Interval[];
  recoveryAfter: number;
}
interface Evidence extends Interval { kind: Exclude<IncidentKind, 'unsure'>; reason: string }
const CLAIMS: Claim[] = ['AUDIO_MISSING', 'AWAY_SCENE'];

export class IncidentEngine {
  readonly history: StateHistory;
  private time = 0;
  private reports: Report[] = [];
  private incidents: Incident[] = [];
  private entries: TimelineEntry[] = [];
  private emitted: EngineEvent[] = [];
  private publicOverlay: OverlayView | null = null;
  private lastPublicAt = -Infinity;
  private lastWolfAt = -Infinity;
  private wolves = 0;
  private sequence = 0;
  private paused = false;

  constructor(readonly config: Config) { this.history = new StateHistory(config); }
  get now(): number { return this.time; }
  get events(): EngineEvent[] { return this.emitted.map((e) => ({ ...e })); }

  observe(frame: TelemetryFrame): void {
    if (frame.at < this.time) throw new Error('Cannot ingest telemetry before current clock');
    this.history.add(frame);
    this.time = frame.at;
  }

  private live(frame = this.history.latest): boolean {
    return !!frame && frame.connected && (!this.config.requireLive || frame.streaming === true);
  }
  private route(frame: TelemetryFrame): boolean {
    return this.live(frame) && frame.globalMic === true && frame.faderDb !== null
      && frame.faderDb >= this.config.minimumFaderDb && frame.monitorAllowsOutput === true && !frame.transitioning;
  }
  private meter(frame: TelemetryFrame): boolean {
    return frame.meterFresh && frame.micDb !== null && !Number.isNaN(frame.micDb);
  }
  private healthy(frame: TelemetryFrame): boolean {
    return this.route(frame) && frame.micMuted === false && this.meter(frame);
  }
  private freshNow(): boolean {
    return this.history.latest !== null && this.time - this.history.latest.at <= this.config.bucketMs;
  }
  private reaction(report: Pick<Report, 'at'>): Interval {
    return {
      start: report.at - this.config.delayMaxMs - this.config.reactionMs - this.config.transportMs,
      end: report.at - this.config.delayMinMs,
    };
  }
  private eligible(): Report[] { return this.reports.filter((r) => this.time - r.at <= this.config.consensusMs); }
  private distinct(claim: Claim): Report[] {
    const users = new Map<string, Report>();
    for (const report of this.eligible().filter((r) => r.claim === claim))
      if (!users.has(report.userId)) users.set(report.userId, report);
    return [...users.values()];
  }

  report(message: ChatMessage, claim: Claim): void {
    if (!Number.isFinite(message.at) || message.at < 0 || message.at < this.time - this.config.consensusMs) return;
    this.time = Math.max(this.time, message.at);
    if (!this.live() || !this.freshNow()) return;
    const report: Report = { id: message.id, userId: message.userId, displayName: message.displayName.slice(0, 40), at: message.at, sourceBroadcasterId: message.sourceBroadcasterId, claim };
    const range = this.reaction(report);
    // Grace absorption comes BEFORE any healthy/wolf verdict. Tombstones also absorb later overlapping reports.
    const related = [...this.incidents].reverse().find((incident) => incident.claim === claim && incident.kind !== 'unsure'
      && (incident.state === 'confirmed' || incident.state === 'recovering'
        || (incident.state === 'grace' && message.at <= incident.graceEndsAt!)
        || incident.faultPeriods.some((period) => overlaps(period, range))));
    if (related) {
      if (related.state !== 'closed') this.addReporter(related, report);
      this.refreshOverlay();
      return;
    }
    if (!this.reports.some((r) => r.id === report.id)) this.reports.push(report);
    this.evaluate(claim);
  }

  private addReporter(incident: Incident, report: Report): void {
    if (incident.reporters.has(report.userId)) return;
    incident.reporters.set(report.userId, report);
    incident.reporterCount = incident.reporters.size;
    const first = [...incident.reporters.values()].sort((a, b) => a.at - b.at)[0]!;
    incident.firstReporter = first.displayName;
  }

  private evidence(reports: Report[], claim: Claim): Evidence | null {
    const matches = (run: Interval) => reports.every((report) => overlaps(run, this.reaction(report)));
    if (claim === 'AUDIO_MISSING') {
      const muted = this.history.runs((f) => this.live(f) && f.globalMic === true && f.micMuted === true, this.time)
        .find((r) => r.end - r.start >= this.config.muteMs && matches(r));
      if (muted) return { ...muted, kind: 'mute', reason: 'Selected global OBS microphone is muted.' };
      const silence = this.history.runs((f) => this.healthy(f) && f.micDb! < this.config.signalDb, this.time)
        .find((r) => r.end - r.start >= this.config.silenceMs && matches(r));
      if (silence) return { ...silence, kind: 'silence', reason: 'Fresh unmuted global microphone signal stayed below the calibrated threshold.' };
    } else {
      const away = this.history.runs((f) => this.live(f) && !f.transitioning && f.scene !== null && this.config.awayScenes.includes(f.scene), this.time)
        .find((r) => r.end - r.start >= this.config.awayMs && matches(r)
          && this.history.segments(r.start, r.end).some((s) => {
            const end = Math.min(r.end, s.start + 3000);
            return this.history.segments(s.start, end).reduce((duration, segment) => duration
              + (this.healthy(segment.frame) && segment.frame.micDb! >= this.config.signalDb ? segment.end - segment.start : 0), 0) >= 1000;
          }));
      if (away) return { ...away, kind: 'away', reason: 'Configured away scene is on Program while microphone activity is present.' };
    }
    return null;
  }

  private isWolf(reports: Report[]): boolean {
    let speechMs = 0;
    let totalMs = 0;
    for (const interval of mergeIntervals(reports.map((r) => this.reaction(r)))) {
      if (!this.history.complete(interval.start, interval.end)) return false;
      let quietMs = 0;
      for (const { frame, start, end } of this.history.segments(interval.start, interval.end)) {
        if (!this.healthy(frame) || frame.epoch !== this.history.latest?.epoch) return false;
        const duration = end - start;
        totalMs += duration;
        if (frame.micDb! >= this.config.signalDb) { speechMs += duration; quietMs = 0; }
        else quietMs += duration;
        if (quietMs > this.config.wolfQuietMs) return false;
      }
    }
    return totalMs > 0 && speechMs / totalMs >= this.config.wolfSpeechFraction;
  }

  private evaluate(claim: Claim): void {
    if (!this.live() || !this.freshNow()) return;
    const reports = this.distinct(claim);
    if (reports.length < this.config.consensusCount) return;
    if (this.incidents.some((i) => i.claim === claim && ['confirmed', 'recovering', 'grace'].includes(i.state))) return;
    const evidence = this.evidence(reports, claim);
    let existing = this.incidents.find((i) => i.claim === claim && i.state === 'unsure');
    if (evidence) {
      const incident = existing ?? this.createIncident(reports, claim);
      incident.kind = evidence.kind;
      incident.state = 'confirmed';
      incident.startedAt = evidence.start;
      incident.segmentStart = evidence.start;
      incident.recoveryAfter = evidence.end;
      incident.onsetBeforeHistory = evidence.start <= this.history.oldestAt;
      incident.reason = evidence.reason;
      incident.confirmedAt = this.time;
      for (const report of reports) this.addReporter(incident, report);
      this.reports = this.reports.filter((r) => r.claim !== claim);
      this.event('confirmed', incident.id);
      this.log('Confirmed local issue', evidence.reason, 'warning');
      // Historical issues already repaired need thanks, not a stale repair alert.
      if (!this.recover(incident)) {
        incident.state = this.looksRepaired(incident) ? 'recovering' : 'confirmed';
        if (incident.state === 'confirmed') this.ping(incident);
      }
    } else if (claim === 'AUDIO_MISSING' && this.isWolf(reports)) {
      if (existing) { existing.state = 'closed'; existing = undefined; }
      this.reports = this.reports.filter((r) => r.claim !== claim);
      if (this.time - this.lastWolfAt < this.config.wolfCooldownMs) return;
      this.lastWolfAt = this.time;
      this.wolves++;
      const id = `wolf-${++this.sequence}`;
      this.event('wolf', id);
      this.log('Local mic path looks live', 'Audio reports were not corroborated locally; this does not establish viewer playback.', 'info');
      if (this.config.publicWolf && this.canPublish()) {
        this.lastPublicAt = this.time;
        this.publicOverlay = { id, kind: 'wolf', title: 'Chat cried wolf? 🐺', detail: `Mic's live on my end · Wolf count: ${this.wolves}`, phase: 'stamp', startedAt: this.time, expiresAt: this.time + this.config.stampMs };
      }
    } else if (!existing) {
      const incident = this.createIncident(reports, claim);
      incident.reason = 'Chat reports a problem; historical OBS evidence is incomplete or inconclusive.';
      this.log('Reported, unverified', incident.reason, 'warning');
      this.ping(incident);
    }
  }

  private createIncident(reports: Report[], claim: Claim): Incident {
    const incident: Incident = {
      id: `incident-${++this.sequence}`, claim, kind: 'unsure', state: 'unsure', reporterCount: 0,
      firstReporter: '', startedAt: reports[0]!.at, confirmedAt: this.time, recoveredAt: null, graceEndsAt: null,
      acknowledged: false, pingCount: 0, reason: '', onsetBeforeHistory: false, reporters: new Map(),
      lastPingAt: null, recoveryShownAt: null, completedDurationMs: 0, segmentStart: reports[0]!.at, faultPeriods: [], recoveryAfter: this.time,
    };
    for (const report of reports) this.addReporter(incident, report);
    this.incidents.push(incident);
    return incident;
  }

  private recoveryStart(incident: Incident): number | null {
    const start = this.time - this.config.recoveryMs;
    if (!this.freshNow() || !this.history.complete(start, this.time)) return null;
    const segments = this.history.segments(start, this.time);
    if (incident.claim === 'AWAY_SCENE') {
      const run = this.history.runs((f) => this.live(f) && f.scene !== null && !this.config.awayScenes.includes(f.scene) && !f.transitioning, this.time).at(-1);
      if (run && run.end === this.time && run.end - run.start >= this.config.recoveryMs) return Math.max(run.start, incident.recoveryAfter);
      return null;
    }
    if (!segments.every(({ frame }) => this.healthy(frame))) return null;
    const speech = segments.filter(({ frame }) => frame.micDb! >= this.config.recoveryDb);
    if (speech.reduce((sum, s) => sum + s.end - s.start, 0) < this.config.recoveryMs / 2) return null;
    let candidate: number | null = null;
    let quietMs = 0;
    let cursor = incident.recoveryAfter;
    for (const segment of this.history.segments(incident.recoveryAfter, this.time)) {
      if (segment.start !== cursor || !this.healthy(segment.frame)) { candidate = null; quietMs = 0; }
      if (this.healthy(segment.frame)) {
        if (segment.frame.micDb! >= this.config.recoveryDb) { candidate ??= segment.start; quietMs = 0; }
        else { quietMs += segment.end - segment.start; if (quietMs > this.config.wolfQuietMs) candidate = null; }
      }
      cursor = segment.end;
    }
    return candidate !== null && this.time - candidate >= this.config.recoveryMs ? candidate : null;
  }

  private looksRepaired(incident: Incident): boolean {
    const frame = this.history.latest;
    if (!frame || !this.freshNow()) return false;
    return incident.claim === 'AWAY_SCENE'
      ? this.live(frame) && !frame.transitioning && frame.scene !== null && !this.config.awayScenes.includes(frame.scene)
      : this.healthy(frame) && frame.micDb! >= this.config.recoveryDb;
  }

  private recover(incident: Incident): boolean {
    const start = this.recoveryStart(incident);
    if (start === null) return false;
    incident.state = 'grace';
    incident.recoveredAt = start;
    incident.graceEndsAt = this.time + this.config.graceMs;
    incident.completedDurationMs += Math.max(0, start - incident.segmentStart);
    incident.faultPeriods.push({ start: incident.segmentStart, end: start });
    this.event('recovered', incident.id);
    this.log('Fix stable · chat gets the credit', `${incident.reporterCount} distinct viewers; late reports continue counting during grace.`, 'good');
    if (!incident.acknowledged && this.canPublish()) {
      incident.recoveryShownAt = this.time;
      this.lastPublicAt = this.time;
      this.publicOverlay = this.thanks(incident);
    }
    return true;
  }

  private canPublish(): boolean { return !this.paused && this.time - this.lastPublicAt >= this.config.publicCooldownMs; }
  private thanks(incident: Incident): OverlayView {
    const totalSeconds = Math.floor(incident.completedDurationMs / 1000);
    const duration = `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
    const wording = incident.kind === 'mute' ? 'Muted' : incident.kind === 'silence' ? 'Mic went silent' : 'Stuck on BRB';
    return {
      id: incident.id, kind: 'thanks', title: 'CHAT KNEW',
      detail: `${wording} for ${incident.onsetBeforeHistory ? 'at least ' : ''}${duration} · ${incident.reporterCount} of you tried to tell me · First: @${incident.firstReporter}`,
      phase: this.time - incident.recoveryShownAt! >= this.config.stampMs ? 'badge' : 'stamp',
      startedAt: incident.recoveryShownAt!, expiresAt: incident.graceEndsAt!,
      reporterCount: incident.reporterCount, firstReporter: incident.firstReporter,
    };
  }

  private refreshOverlay(): void {
    if (!this.publicOverlay) return;
    if (this.time >= this.publicOverlay.expiresAt || this.paused || !this.live() || !this.freshNow()) { this.publicOverlay = null; return; }
    if (this.publicOverlay.kind === 'thanks') {
      const incident = this.incidents.find((i) => i.id === this.publicOverlay!.id);
      if (!incident || incident.acknowledged || incident.state !== 'grace') this.publicOverlay = null;
      else this.publicOverlay = this.thanks(incident);
    }
  }

  tick(at: number): void {
    if (!Number.isFinite(at) || at < this.time) throw new Error('Clock must advance monotonically');
    this.time = at;
    this.reports = this.eligible();
    for (const incident of this.incidents) {
      if (incident.state === 'grace' && at >= incident.graceEndsAt!) {
        incident.state = 'closed';
        this.log('Incident closed', `${incident.reporterCount} distinct viewers counted.`, 'info');
      } else if (incident.state === 'grace' && this.live() && this.freshNow()) {
        const latest = this.history.latest!;
        const bad = incident.claim === 'AWAY_SCENE'
          ? latest.scene !== null && this.config.awayScenes.includes(latest.scene)
          : latest.micMuted === true || (this.healthy(latest) && latest.micDb! < this.config.signalDb);
        // A normal short pause after recovery is not a new silence episode.
        const minimum = latest.micMuted === true ? this.config.muteMs : incident.claim === 'AWAY_SCENE' ? this.config.awayMs : this.config.silenceMs;
        const recent = this.history.segments(at - minimum, at);
        const badThroughout = this.history.complete(at - minimum, at) && recent.every(({ frame: f }) => incident.claim === 'AWAY_SCENE'
          ? this.live(f) && !f.transitioning && f.scene !== null && this.config.awayScenes.includes(f.scene)
          : this.live(f) && (f.micMuted === true || (this.healthy(f) && f.micDb! < this.config.signalDb)));
        if (bad && badThroughout) {
          incident.state = 'confirmed';
          incident.segmentStart = at - minimum;
          incident.recoveryAfter = at;
          incident.recoveredAt = null;
          incident.graceEndsAt = null;
          this.log('Issue returned', 'Continuing the same incident; recovered graphic retracted.', 'warning');
        }
      }
      if (incident.state === 'confirmed' || incident.state === 'recovering') {
        if (!this.live() || !this.freshNow()) continue;
        if (this.recover(incident)) continue;
        incident.state = this.looksRepaired(incident) ? 'recovering' : 'confirmed';
        const lowRun = this.history.runs((f) => this.healthy(f) && f.micDb! < this.config.signalDb, at).at(-1);
        if (incident.claim === 'AUDIO_MISSING' && incident.kind === 'mute' && lowRun?.end === at && lowRun.end - lowRun.start >= this.config.silenceMs) {
          incident.kind = 'silence';
          incident.reason = 'OBS mute cleared; waiting for microphone signal recovery.';
        }
        if (incident.state === 'confirmed') this.ping(incident);
      }
      if (incident.state === 'unsure' && this.time - incident.confirmedAt >= 60_000) incident.state = 'closed';
    }
    for (const claim of CLAIMS) this.evaluate(claim);
    this.refreshOverlay();
    this.incidents = this.incidents.filter((i) => i.state !== 'closed' || this.time - (i.graceEndsAt ?? i.confirmedAt) < 120_000).slice(-50);
  }

  acknowledge(at = this.time): void {
    this.time = Math.max(this.time, at);
    const incident = [...this.incidents].reverse().find((i) => i.state !== 'closed');
    if (!incident || incident.acknowledged) return;
    incident.acknowledged = true;
    this.event('acknowledged', incident.id);
    this.log('I know · acknowledged', 'Repeating alerts and public thanks suppressed for this incident.', 'info');
    this.refreshOverlay();
  }
  toggleAlerts(): void { this.paused = !this.paused; this.refreshOverlay(); }

  private ping(incident: Incident): void {
    if (this.paused || incident.acknowledged || incident.pingCount >= this.config.pingMax) return;
    if (incident.lastPingAt !== null && this.time - incident.lastPingAt < this.config.pingIntervalMs) return;
    const previousPing = this.emitted.filter((e) => e.type === 'ping').at(-1);
    if (previousPing && this.time - previousPing.at < this.config.pingIntervalMs) return;
    incident.pingCount++;
    incident.lastPingAt = this.time;
    this.event('ping', incident.id);
    this.log(`Private ping ${incident.pingCount}/${this.config.pingMax}`, 'SIMULATION: request recorded; no sound is played.', 'warning');
  }
  private event(type: EngineEvent['type'], incidentId: string): void {
    this.emitted.push({ type, at: this.time, incidentId });
    if (this.emitted.length > 500) this.emitted.shift();
  }
  private log(label: string, detail: string, tone: TimelineEntry['tone']): void {
    this.entries.push({ id: `entry-${++this.sequence}`, at: this.time, label, detail, tone });
    if (this.entries.length > 50) this.entries.shift();
  }

  snapshot(): EngineView {
    const active = [...this.incidents].reverse().find((i) => i.state !== 'closed') ?? this.incidents.at(-1);
    let incident: IncidentView | null = null;
    if (active) {
      const { reporters: _reporters, lastPingAt: _lastPingAt, recoveryShownAt: _shown, completedDurationMs: _duration, segmentStart: _segment, faultPeriods: _periods, recoveryAfter: _after, ...view } = active;
      incident = { ...view };
    }
    return {
      now: this.time, telemetry: this.history.latest ? { ...this.history.latest } : null,
      consensus: { audio: this.distinct('AUDIO_MISSING').length, away: this.distinct('AWAY_SCENE').length, required: this.config.consensusCount },
      incident, timeline: this.entries.map((e) => ({ ...e })), overlay: this.publicOverlay ? { ...this.publicOverlay } : null,
      wolfCount: this.wolves, paused: this.paused,
    };
  }
}
