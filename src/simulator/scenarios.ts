import type { ChatMessage, Scenario, TelemetryFrame } from '../types.js';

type FrameState = Omit<TelemetryFrame, 'at' | 'epoch'>;

const FAULT_START = 25_000;
const FIX_AT = 45_000;

function healthyFrame(): FrameState {
  return {
    connected: true,
    streaming: true,
    micMuted: false,
    micDb: -20,
    meterFresh: true,
    globalMic: true,
    faderDb: 0,
    monitorAllowsOutput: true,
    scene: 'Just Chatting',
    transitioning: false,
  };
}

function duringFault(at: number): boolean {
  return at >= FAULT_START && at < FIX_AT;
}

function message(
  scenarioId: string,
  index: number,
  user: number,
  displayName: string,
  text: string,
  at: number,
): ChatMessage {
  return {
    id: `sim-${scenarioId}-message-${index}`,
    userId: `sim-viewer-${user}`,
    displayName,
    text,
    at,
    sourceBroadcasterId: null,
  };
}

function audioReports(id: string): ChatMessage[] {
  return [
    message(id, 1, 1, 'Mira', "you're muted", 35_000),
    message(id, 2, 2, 'Dev', 'आवाज़ नहीं आ रही', 35_500),
    message(id, 3, 3, 'Kai', "can't hear you", 36_000),
  ];
}

/** Synthetic data only. A hardware-mute-shaped frame is not a hardware diagnosis. */
export const scenarios: Scenario[] = [
  {
    id: 'obs-mute',
    title: 'The classic mute',
    description: 'Three viewers report a muted mic. A manual fix earns chat an immediate thank-you.',
    durationMs: 76_000,
    expected: 'mute',
    frameAt: (at) => ({
      ...healthyFrame(),
      micMuted: duringFault(at),
      micDb: duringFault(at) ? -100 : -20,
    }),
    messages: audioReports('obs-mute'),
  },
  {
    id: 'hardware-mute',
    title: 'The silent mic',
    description: 'The mic is unmuted but the signal disappears. Chat helps catch the missing signal.',
    durationMs: 76_000,
    expected: 'silence',
    frameAt: (at) => ({
      ...healthyFrame(),
      micDb: duringFault(at) ? -100 : -20,
    }),
    messages: [
      message('hardware-mute', 1, 1, 'Mira', 'no audio', 35_000),
      message('hardware-mute', 2, 2, 'Dev', 'आवाज़ नहीं आ रही', 35_500),
      message('hardware-mute', 3, 3, 'Kai', 'silent cinema 💀', 36_000),
    ],
  },
  {
    id: 'brb',
    title: 'Still on BRB',
    description: 'The streamer is talking while the program scene still says BRB. Viewers spot it.',
    durationMs: 76_000,
    expected: 'away',
    frameAt: (at) => ({
      ...healthyFrame(),
      scene: duringFault(at) ? 'BRB' : 'Just Chatting',
    }),
    messages: [
      message('brb', 1, 1, 'Mira', 'nice BRB screen', 35_000),
      message('brb', 2, 2, 'Dev', 'still on BRB', 35_500),
      message('brb', 3, 3, 'Kai', 'you forgot the BRB screen', 36_000),
    ],
  },
  {
    id: 'wolf',
    title: 'Chat cried wolf?',
    description: 'Three audio reports meet a healthy local mic with ordinary one-second speech pauses.',
    durationMs: 42_000,
    expected: 'wolf',
    frameAt: (at) => ({
      ...healthyFrame(),
      // Three seconds of speech followed by a one-second sentence pause.
      micDb: at % 4_000 >= 3_000 ? -100 : -20,
    }),
    messages: [
      message('wolf', 1, 1, 'Mira', "you're muted", 30_000),
      message('wolf', 2, 2, 'Dev', 'no audio', 31_000),
      message('wolf', 3, 3, 'Kai', "can't hear you", 32_000),
    ],
  },
  {
    id: 'delayed-fix',
    title: 'Late chat, same save',
    description: 'Delayed warnings join the repaired incident and update the live badge. No wolf call.',
    durationMs: 76_000,
    expected: 'mute',
    frameAt: (at) => ({
      ...healthyFrame(),
      micMuted: duringFault(at),
      micDb: duringFault(at) ? -100 : -20,
    }),
    messages: [
      ...audioReports('delayed-fix'),
      message('delayed-fix', 4, 4, 'Noor', 'muted!!', 52_000),
      // A repeat from the same viewer must not inflate the unique count.
      message('delayed-fix', 5, 4, 'Noor', "still can't hear you", 53_500),
      message('delayed-fix', 6, 5, 'Sol', 'no audio', 55_000),
    ],
  },
];

export function getScenario(id: string): Scenario {
  const scenario = scenarios.find((entry) => entry.id === id);
  if (!scenario) throw new RangeError(`Unknown simulator scenario: ${id}`);
  return scenario;
}
