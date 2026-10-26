import { readFileSync } from 'node:fs';
import { z } from 'zod';

export const ConfigSchema = z.object({
  port: z.number().int().min(1024).max(65535).default(8787),
  broadcasterId: z.string().min(1).default('streamer'),
  botId: z.string().min(1).default('chat-knew-bot'),
  awayScenes: z.array(z.string().min(1)).default(['BRB', 'Starting Soon', 'Ending']),
  bucketMs: z.literal(250).default(250),
  historyMs: z.number().int().min(1000).default(60_000),
  consensusCount: z.number().int().min(2).max(100).default(3),
  consensusMs: z.number().int().positive().default(20_000),
  delayMinMs: z.number().int().nonnegative().default(2_000),
  delayMaxMs: z.number().int().nonnegative().default(15_000),
  reactionMs: z.number().int().nonnegative().default(3_000),
  transportMs: z.number().int().nonnegative().default(2_000),
  analysisLagMs: z.number().int().nonnegative().default(9_000),
  silenceMs: z.number().int().positive().default(8_000),
  muteMs: z.number().int().positive().default(500),
  awayMs: z.number().int().positive().default(3_000),
  signalDb: z.number().min(-100).max(0).default(-40),
  recoveryDb: z.number().min(-100).max(0).default(-35),
  minimumFaderDb: z.number().min(-100).max(0).default(-30),
  recoveryMs: z.number().int().min(1000).default(2_000),
  graceMs: z.number().int().positive().default(25_000),
  stampMs: z.number().int().positive().default(6_000),
  wolfQuietMs: z.number().int().positive().default(3_000),
  wolfSpeechFraction: z.number().min(0.5).max(1).default(0.5),
  publicWolf: z.boolean().default(true),
  requireLive: z.boolean().default(true),
  publicCooldownMs: z.number().int().nonnegative().default(60_000),
  wolfCooldownMs: z.number().int().nonnegative().default(180_000),
  pingIntervalMs: z.number().int().min(30_000).default(30_000),
  pingMax: z.number().int().min(1).max(4).default(4),
}).strict().superRefine((c, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
  if (c.delayMinMs > c.delayMaxMs) issue('delayMinMs must not exceed delayMaxMs');
  const age = c.delayMaxMs + c.reactionMs + c.transportMs;
  if (c.historyMs < c.consensusMs + age + c.silenceMs + c.analysisLagMs + 2000)
    issue('historyMs must cover consensus, reaction age, silence, analysis lag and 2 s margin');
  if (c.graceMs < age + 5000) issue('graceMs must cover reaction age plus 5 s');
  if (c.stampMs >= c.graceMs) issue('stampMs must be shorter than graceMs');
  if (c.recoveryDb < c.signalDb) issue('recoveryDb must be at least signalDb');
});

export type Config = z.infer<typeof ConfigSchema>;
export const defaultConfig = (): Config => ConfigSchema.parse({});
export function loadConfig(path?: string): Config {
  if (path) return ConfigSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
  try { return ConfigSchema.parse(JSON.parse(readFileSync('config.json', 'utf8'))); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return defaultConfig();
    throw error;
  }
}
