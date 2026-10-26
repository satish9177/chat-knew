import type { Config } from './config.js';
import type { ChatMessage } from './types.js';
import { IncidentEngine } from './engine/incidents.js';
import { keywordClaim } from './analysis/keywords.js';

export class ChatPipeline {
  private seen = new Map<string, number>();
  constructor(private readonly engine: IncidentEngine, private readonly config: Config) {}

  chat(message: ChatMessage): void {
    if (message.userId === this.config.botId || message.userId === this.config.broadcasterId) return;
    if (message.sourceBroadcasterId && message.sourceBroadcasterId !== this.config.broadcasterId) return;
    if (!message.id || !message.userId || !Number.isFinite(message.at) || message.at < 0) return;
    if (message.at < this.engine.now - this.config.consensusMs || this.seen.has(message.id)) return;
    for (const [id, at] of this.seen) if (message.at - at > 120_000) this.seen.delete(id);
    this.seen.set(message.id, message.at);
    if (this.seen.size > 10_000) this.seen.delete(this.seen.keys().next().value!);
    const claim = keywordClaim(message.text.slice(0, 1000));
    if (claim) this.engine.report({ ...message, text: '' }, claim);
  }
}
