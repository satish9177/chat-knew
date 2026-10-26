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

**PLANNED.** Build the shared pipeline, five scenarios, timing/consensus tests, and basic dashboard/overlay. Exit: visible replay with passing regression tests and no post-fix wolf event.

## M2 — real Twitch and OBS

**PLANNED.** Add auth, EventSub, OBS evidence/reconnect, and private alert calibration. Exit: real three-viewer mute → repair → thank-you, with recorded meter/no-leak results and exact versions.

## M3 — classifier, polish, and handoff

**PLANNED.** Add structured classification/fallback, verify remaining live scenarios, polish visuals, and test clean-clone setup. Exit: feature-complete core, documented limitations, passing relevant checks; optional sends only if time remains.

## Acceptance stream and submission

**PLANNED.** Oct 30–31: friends test; Nov 1: video; Nov 2: submit early. Record actual outcomes, changes, real Codex session ID, and links when they exist. Do not mark a live check passed based on simulator output.
