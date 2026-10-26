# Chat Knew — build log

Keep each entry short: date, work, decisions, visible evidence, and remaining gaps. Planned milestones below are not completion claims.

## Phase 1 — design, 26 October 2026

- Read the complete brief and inspected the repository: only the initial README was present; no application implementation was found.
- Used Codex in this chat to produce DESIGN.md, with research subagents checking current Twitch and OBS primary documentation. Checked official OpenAI model, SDK, structured-output, pricing, and retention docs; rechecked Devpost rules.
- Proposed a deterministic incident engine, per-report historical reaction intervals, distinct-viewer consensus, post-recovery grace/episode absorption, and keyword-only credential-free replay. The model extracts claims only; OBS evidence controls local verdicts; the streamer performs all fixes.
- Proposed changes for review: bound wolf wording to local OBS evidence and make the public graphic opt-in; describe hardware mute as low/no signal; account for OBS version differences and monitoring-device recapture. Keep optional bot sends deferred because user-token Shared Chat sends can reach other channels.
- Artifacts: [DESIGN.md](DESIGN.md). Validation: source review, schema JSON parsing, balanced Markdown fences, and Git whitespace checks passed. No application code, dependency install, runtime tests, Twitch login/subscription/message, OBS change, or paid OpenAI request was performed.
- Status at delivery: **AWAITING DESIGN REVIEW**. Live meter behavior, audio privacy, account/model access, timing calibration, and all runtime behavior remained untested.

## Design review — approved, 26 October 2026

- Incorporated the user's review: wolf tolerates ≤3 s pauses with ≥50% speech buckets and defaults on; immediate recovery stamp updates/shrinks through grace; private pings repeat every 30 s (4 total), with per-incident “I know” suppression.
- Approved all-chat 4 s LLM batches, M3 factual bot replies with Shared Chat suppression, global Mic/Aux-only scope, offline-chat test flag, simpler local URL tokens, focused engine tests, and a multilingual demo moment. M2 will measure real Low Latency delay. Removed nested/track verification and comparison study.
- Saved the supplied brief verbatim as BRIEF.md. Documentation approved; next step is M1. No live integrations or paid API calls have run.

## M1 — simulator and engine

**COMPLETE — 26 October 2026 (local simulation only).**

- Built the deterministic history/consensus/incident engine and keyword fallback, plus five synthetic replays through the shared pipeline. Implemented the revised wolf pause/occupancy rule, immediate stable-fix stamp, live unique counts and badge expiry, acknowledgements, repeat-ping cap, cooldowns, and require-live/offline gate.
- Added the tokenized loopback server, disconnected startup mode, dashboard and transparent overlay. Simulator controls cannot call live services. Private pings are visible requests only; no audio plays. README is now UTF-8 and documents startup, scope and future OpenAI chat-text disclosure.
- Verification: TypeScript check and **41 Vitest tests passed** on Node 24.19.0/Windows; both browser scripts pass syntax checks. Tests include all five scenarios, Hindi fallback, normal-pause wolf, stale/missing data, grace counts/dedup, historical repair duration, “I know,” ping limits and cooldowns. Sandbox test temp files were redirected into gitignored `.local/tmp` to avoid a Windows rename restriction.
- Browser QA: confirmed mute → three viewers → recovery stamp; wolf graphic with requested unnamed copy; late count grows 3→5 in the same badge; “I know” retracts it. Visual screenshots are local ignored artifacts. BRIEF.md's SHA-256 matches the original attachment exactly.
- Codex session ID from this chat's app metadata: `01a1775b-8f99-75b3-8269-b3d51b9f591b`. Engine, integration and tests stayed in this chat; subagents handled public UI and simulator fixtures.
- Remaining: real Twitch/OBS connections, auth helper, private audio isolation, actual delay/meter calibration, all-chat LLM calls, bot sends and live multilingual proof are **not implemented/tested**. These remain M2/M3; replay is not hardware validation.

## M2 — real Twitch and OBS

**PLANNED.** Add auth, EventSub, OBS evidence/reconnect, and private alert calibration. Exit: real three-viewer mute → repair → thank-you, with recorded meter/no-leak results and exact versions.

## M3 — classifier, polish, and handoff

**PLANNED.** Add all-chat structured classification/fallback and factual bot replies with Shared Chat suppression, verify live/multilingual scenarios, polish visuals, and test clean-clone setup. Cut bot replies first if late.

## Acceptance stream and submission

**PLANNED.** Oct 30–31: friends test; Nov 1: video; Nov 2: submit early. Record actual outcomes, changes, real Codex session ID, and links when they exist. Do not mark a live check passed based on simulator output.
