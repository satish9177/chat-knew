import type { Config } from '../config.js';
import type { TelemetryFrame } from '../types.js';

export interface Interval { start: number; end: number }
export interface Segment extends Interval { frame: TelemetryFrame }

export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

export function mergeIntervals(intervals: Interval[]): Interval[] {
  const result: Interval[] = [];
  for (const interval of [...intervals].sort((a, b) => a.start - b.start)) {
    const last = result.at(-1);
    if (last && interval.start <= last.end) last.end = Math.max(last.end, interval.end);
    else result.push({ ...interval });
  }
  return result;
}

export class StateHistory {
  private frames: TelemetryFrame[] = [];
  constructor(private readonly config: Config) {}

  add(frame: TelemetryFrame): void {
    if (!Number.isFinite(frame.at) || frame.at < 0) throw new Error('Invalid telemetry time');
    if (this.frames.length && frame.at <= this.frames.at(-1)!.at)
      throw new Error('Telemetry must advance monotonically');
    this.frames.push({ ...frame });
    this.frames = this.frames.filter((item) => item.at + this.config.bucketMs > frame.at - this.config.historyMs);
  }

  get latest(): TelemetryFrame | null { return this.frames.at(-1) ?? null; }
  get oldestAt(): number { return this.frames[0]?.at ?? Infinity; }

  segments(start: number, end: number): Segment[] {
    return this.frames.filter((f) => f.at < end && f.at + this.config.bucketMs > start)
      .map((frame) => ({ frame, start: Math.max(start, frame.at), end: Math.min(end, frame.at + this.config.bucketMs) }));
  }

  complete(start: number, end: number): boolean {
    if (start >= end) return false;
    let cursor = start;
    let epoch: number | undefined;
    for (const segment of this.segments(start, end)) {
      if (segment.start !== cursor || (epoch !== undefined && epoch !== segment.frame.epoch)) return false;
      cursor = segment.end;
      epoch = segment.frame.epoch;
    }
    return cursor === end;
  }

  runs(predicate: (frame: TelemetryFrame) => boolean, end: number): Interval[] {
    const runs: (Interval & { epoch: number })[] = [];
    for (const { frame, start, end: stop } of this.segments(this.oldestAt, end)) {
      if (!predicate(frame)) continue;
      const last = runs.at(-1);
      if (last && last.end === start && last.epoch === frame.epoch) last.end = stop;
      else runs.push({ start, end: stop, epoch: frame.epoch });
    }
    return runs;
  }
}
