import type { ChatMessage, ReplaySink, Scenario } from '../types.js';

/** Deterministic, synchronous replay. Recreate it (and its sink) to restart. */
export class ScenarioReplay {
  private readonly messages: ChatMessage[];
  private readonly acknowledgements: number[];
  private messageIndex = 0;
  private acknowledgementIndex = 0;
  private nextFrameAt = 0;
  private position = 0;
  private started = false;

  constructor(
    readonly scenario: Scenario,
    private readonly sink: ReplaySink,
    private readonly bucketMs = 250,
  ) {
    if (!Number.isFinite(bucketMs) || bucketMs <= 0)
      throw new RangeError('Replay bucketMs must be positive and finite');
    if (!Number.isFinite(scenario.durationMs) || scenario.durationMs < 0)
      throw new RangeError('Scenario durationMs must be nonnegative and finite');
    this.messages = scenario.messages.map((entry) => ({ ...entry })).sort((a, b) => a.at - b.at);
    this.acknowledgements = [...(scenario.acknowledgements ?? [])].sort((a, b) => a - b);
    for (const at of [...this.messages.map((entry) => entry.at), ...this.acknowledgements]) {
      if (!Number.isFinite(at) || at < 0 || at > scenario.durationMs)
        throw new RangeError('Scenario event time must lie within the replay duration');
    }
  }

  get positionMs(): number { return this.position; }
  get finished(): boolean { return this.started && this.position >= this.scenario.durationMs; }

  advanceTo(at: number): void {
    if (!Number.isFinite(at) || at < 0)
      throw new RangeError('Replay time must be nonnegative and finite');
    if (at < this.position)
      throw new RangeError('Replay cannot move backward; create a new replay to restart');
    const target = Math.min(at, this.scenario.durationMs);
    if (this.started && target === this.position) return;

    let lastTickAt = -1;
    while (true) {
      const nextMessageAt = this.messages[this.messageIndex]?.at ?? Infinity;
      const nextAcknowledgementAt = this.acknowledgements[this.acknowledgementIndex] ?? Infinity;
      const eventAt = Math.min(this.nextFrameAt, nextMessageAt, nextAcknowledgementAt);
      if (eventAt > target) break;

      // Telemetry first, then chat/acknowledgement, then lifecycle timers at a shared timestamp.
      if (this.nextFrameAt === eventAt) {
        this.sink.telemetry({ ...this.scenario.frameAt(eventAt), at: eventAt, epoch: 1 });
        this.nextFrameAt += this.bucketMs;
      }
      while (this.messages[this.messageIndex]?.at === eventAt) {
        this.sink.chat({ ...this.messages[this.messageIndex]! });
        this.messageIndex++;
      }
      while (this.acknowledgements[this.acknowledgementIndex] === eventAt) {
        this.sink.acknowledge(eventAt);
        this.acknowledgementIndex++;
      }
      this.sink.tick(eventAt);
      lastTickAt = eventAt;
    }

    if (lastTickAt !== target) this.sink.tick(target);
    this.position = target;
    this.started = true;
  }

  advanceBy(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0)
      throw new RangeError('Replay increment must be nonnegative and finite');
    this.advanceTo(this.position + ms);
  }

  runToEnd(): void { this.advanceTo(this.scenario.durationMs); }
}
