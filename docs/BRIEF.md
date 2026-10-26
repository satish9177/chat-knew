# Chat Knew: project brief

Hey. This is the brief for my entry to the Codex x TwitchCon Hackathon on Devpost. I want us to plan this properly before writing any code, so please read the whole thing. For now I only want a design doc from you (details at the end). Once I've reviewed and approved it, we'll build it together in this thread.

## The hackathon, in short

- It's a Twitch + OpenAI hackathon. The brief is "build for streamers and their community on Twitch with OpenAI Codex."
- The project has to be an interactive experience that connects to Twitch (chat, an overlay, the Twitch API, EventSub). We are **not** building a Twitch Extension: review takes 5–14 days and judges can't install an unreviewed one.
- Everything must be built during the submission period, which started Oct 23, 2026. New repo, new code.
- Deadline: Nov 2, 2:00 PM PT (3:30 AM on Nov 3 for me in India). My plan: feature-complete by Oct 30, a real test stream with friends Oct 30–31, demo video on Nov 1, submit Nov 2.
- The submission is: this repo with setup instructions, a demo video under 3 minutes (showing it working on Twitch and how it was built with Codex), a text description, and the session ID of this Codex thread.
- The video can't include copyrighted music, third-party trademarks or other people's games. So the demo will be me streaming Just Chatting or my own screen, with friends in chat.
- Judges might never run the project. They can score from the video and description alone. The repo still has to run from the README.
- Judging criteria, equally weighted: innovation, impact for streamers and their communities, technical implementation (how well it's built and how well it uses Codex), and design (easy to use, fun to watch). Ties go to whoever scored higher on innovation.
- I don't have much time this week, so scope matters. Simple and polished beats big and half-working.

## The idea

Every Twitch viewer has spammed "YOU'RE MUTED" at a streamer who kept talking for five minutes. The streamer doesn't read chat while they're focused, so the warning never lands. The same thing happens when they come back from a break and forget to switch off the BRB scene, or when the hardware mute switch on their mic is on.

Chat always knows first. Chat Knew makes the stream listen to them.

When several viewers report the same problem, Chat Knew checks OBS to see whether it's real. If it is, it alerts the streamer privately, and once the problem is fixed it puts a short stamp on stream giving chat the credit. If chat is just trolling (they love spamming "muted" as a joke), it calls the bluff, playfully.

The line I want to use in the README and the video: **"Mute plugins listen to your mic. Chat Knew listens to your viewers."**

### What already exists (so we're honest about it)

- **Muted Notification** (OBS plugin): plays a sound or shows a red dot if your mic picks up audio while that source is muted in OBS.
- **Remember to Talk** (OBS plugin): privately pings you, through OBS monitor-only audio, if you've been silent for too long.
- **Chat keyword-alert tools**: beep when chat mentions a word.

None of them read what viewers are telling the streamer, check it against OBS, or catch the things only viewers notice: a hardware mute (OBS thinks the mic is fine), being stuck on the BRB scene, the mic missing from the live scene, or chat crying wolf. We'll credit these tools in the README.

### What it feels like

**Viewers** learn nothing new. No commands. They type what they already type: "muted", "can't hear you", "bro is doing silent cinema 💀", "nice BRB screen", "awaaz nahi aa rahi". Any language.

**The streamer** makes zero clicks while live. They set it up once (run the app, add one browser source in OBS) and forget about it. When something is really wrong, they hear a private ping in their headphones and see the problem on a small dashboard. They fix it themselves.

**On stream**, once the problem is fixed, a stamp slides in:

> **CHAT KNEW**
> Muted for 2:13 · 31 of you tried to tell me · First: @name

(Or "No mic signal for 1:12 · …", "Stuck on BRB for 0:45 · …")

If chat raised a false alarm and the mic was clearly live the whole time:

> **Chat cried wolf 🐺**
> Mic is live · wolf calls this stream: 3

Optionally, the bot posts one short chat message when a real incident is confirmed ("🔔 Streamer alerted: mic shows no signal") so chat knows the warning landed and stops spamming. Bot messages should be rare.

### Incidents, in priority order

Must have. These are the demo:

1. **Mic muted in OBS.** OBS says the mic input is muted.
2. **No mic signal.** OBS says the mic is unmuted, but the level stayed below speaking volume during the time viewers were complaining. This covers a hardware mute switch, a dead mic or the wrong device. The plugins above can't catch it, so it's our hero scene.
3. **Stuck on an away scene.** The program scene is one of my configured away scenes (BRB, Starting Soon, Ending), chat says so, and I'm clearly talking (speech on the mic).
4. **False alarm (cried wolf).** Chat claims there's no audio, but every check says viewers can hear me.

Nice to have, only if there's time:

5. Mic not reaching the stream because of a config problem: fader at zero, set to "monitor only", or not in the live scene.
6. Game or desktop audio missing, or drowning out my voice.
7. Lag triage. Chat says "lagging", we check OBS output stats, then either reply in chat that the stream output looks healthy (try refreshing) or alert me if frames are dropping.

Even if #5 isn't its own incident in v1, the wolf verdict has to check those things (see the rules below).

## Rules that matter (please design around these)

**OBS is the source of truth; the LLM only reads chat.** The model's job is to say "these viewers are claiming X". It never decides whether the problem is real. OBS telemetry does.

**Stream delay will break naive logic.** Viewers see the stream several seconds late (roughly 2–15 s; make it configurable). So:

- Keep a rolling history of OBS state (about 60 s, a few snapshots per second) and judge each chat claim against what viewers were seeing when they typed it, not against the current state.
- After a fix, delayed "muted!!" messages keep arriving for a while. Add a grace period after every resolution where matching claims are counted toward the incident that just ended. They must never turn into a wolf call.
- If OBS was muted or silent at any point in the window viewers were reacting to, it is not a false alarm.

**Wolf calls must be conservative.** Only call wolf when, for the whole relevant window: the mic input isn't muted, there's real speech-level signal, the fader is up, the monitor type isn't "monitor only", and the mic is actually in the program scene (or is a global audio device). If anything is uncertain, say nothing publicly; at most, ping me privately.

**Name the hero, never the villain.** The first person who reported a real problem gets credit on the stamp. Nobody gets named for a false alarm. A viewer whose own tab was muted isn't a troll, and if we're ever wrong we'd be mocking someone who was right.

**Never auto-fix.** Don't auto-unmute (muting is sometimes deliberate: a phone call, family) and don't switch scenes automatically. Alert me and let me act.

**The private alert has to actually be private.** A sound played to the default Windows output gets picked up by OBS's Desktop Audio and goes out on stream. Play it through an OBS media source set to "monitor only" (that's how Remember to Talk does it), and we'll check on my setup that it doesn't leak.

**Consensus, not one message.** Require several distinct chatters (default 3) within a short window (default 20 s). Count people, not messages. Ignore the bot and the streamer. During a Shared Chat session, ignore messages whose `source_broadcaster_user_id` is another channel; those viewers are watching a different stream.

**Cooldowns on everything public.** Stamps and bot messages must never spam.

**Privacy.** Don't write raw chat to disk; keep a rolling window in memory. When sending chat to the LLM, send the message text with short local IDs instead of usernames, and map back locally.

**No copyrighted assets.** Sounds are generated in code (Web Audio or simple tones) or CC0. No fonts or images we don't have rights to.

## Tech I'd like to use

These are my preferences. If you think something is a bad fit, say so in the design and explain why.

- **Runtime:** Node.js 22+ with TypeScript. One local process on the streamer's PC. My machine is Windows 11 (PowerShell), but keep it cross-platform. The app should start even if OBS or Twitch isn't reachable yet, show that clearly, and reconnect on its own.
- **Twitch:** EventSub over WebSocket for `channel.chat.message` (no public URL needed), and Helix "Send Chat Message" for the occasional bot message. The bot account's token has `user:bot user:read:chat user:write:chat`, and the bot is a mod in my channel. Handle keepalives, reconnect messages and token refresh. Twurple (`@twurple/*`) is fine if it makes this simpler; your call.
- **OBS:** OBS WebSocket v5 (built into OBS) through `obs-websocket-js`. Subscribe to all the normal events plus `InputVolumeMeters`: that's 2047 | 65536 = 67583, because subscribing with 65536 alone drops the normal events. Things we'll probably need: input mute state and changes, volume meters, input volume (fader), audio monitor type, the program scene (not the preview scene if Studio Mode is on) and its scene items, special inputs (global mic/desktop devices), and stream status/stats for lag. Handle OBS not running or restarting. Please test what the volume meters report when a source is muted or behind a noise gate rather than assuming.
- **LLM:** the OpenAI API through the official `openai` package, with structured JSON output. A small, fast, cheap model set through `OPENAI_MODEL`; pick a current one, tell me why, and roughly what an hour of live use would cost. Use a cheap pre-filter first (keywords in a few languages, sudden bursts of "?" and the like) so we only call the model when chat looks suspicious, batching every few seconds. If there's no API key, fall back to keyword-only mode so anyone can still run it.
- **Overlay:** a plain HTML/CSS/JS page served by the app (1920×1080, transparent), used as an OBS Browser Source and fed events over a local WebSocket. No React or build step needed. It gets added to every scene, including BRB, so the stamp shows wherever I am. It should look like a clean broadcast graphic, readable at a glance, animating in and out.
- **Dashboard:** a small local web page for the streamer that can be docked inside OBS as a Custom Browser Dock. It shows connection status, live mic level, mute state and scene, the current incident, a readable timeline of recent incidents (useful for debugging and for the video), and test buttons.
- **Simulator / replay mode:** scripted scenarios that push fake chat and fake OBS state through the real pipeline, so judges (and our tests) can see everything without a live stream, Twitch credentials or OBS. At minimum: OBS mute, hardware mute, stuck on BRB, cried wolf, and "delayed messages after a fix", which must not produce a wolf call.
- **Config:** secrets in `.env`, with a committed `.env.example`. Everything else (scene names, mic input name, thresholds, delays) goes in a config file with sensible defaults, auto-detected where possible.
- **Tests:** Vitest. Unit-test the incident engine, the timing windows, consensus and the parsing of classifier output. The simulator scenarios double as integration tests.
- **Setup for other people:** a one-command auth helper (`npm run auth` or similar) that opens the Twitch login, catches the localhost redirect and saves the tokens, so nobody needs Twitch CLI. Tell me which redirect URL to register on my Twitch app.

Keep dependencies small. No database, no Docker, no cloud deployment; it runs on the streamer's machine.

## Where I'm at

- Done: Twitch account, this GitHub repo, Codex.
- Not done yet: registering the Twitch app and getting tokens, an OpenAI API key, OBS WebSocket setup. Please include a short step-by-step checklist for these in the design (for Windows).

## What I want from you now (Phase 1: design only)

Please don't write application code yet. Instead:

1. If something important is unclear, ask me (five questions at most). Otherwise make sensible assumptions and list them.
2. If you can, check the current docs for Twitch EventSub/Helix, OBS WebSocket v5 and the OpenAI SDK, since APIs change. Flag anything you couldn't verify. Use subagents for this research if that helps.
3. Write `docs/DESIGN.md`, covering:
   - Your understanding of the idea in a few lines, plus anything you'd push back on or improve.
   - The architecture: modules, how data flows, a simple diagram.
   - The incident model: a truth table of chat claim × OBS evidence → verdict (real / false alarm / unsure), with thresholds.
   - The timing model: state history, the delay window, the grace period, the consensus window, how incidents start and resolve.
   - Chat analysis: the pre-filter, batching, the LLM prompt and JSON schema, fallback mode, a cost estimate, privacy.
   - Exactly which OBS requests/events and which Twitch endpoints/events we use, plus the auth flow and scopes.
   - The alert, overlay and dashboard design: states, copy text, the animation idea, the private alert approach.
   - Config, the setup checklist for me, and the repo layout.
   - The simulator design and the test plan.
   - A build plan in milestones sized for about 3 days, each ending in something I can see working.
   - Risks and open questions.
   - A shot list for the 3-minute demo video: what needs to be visible to prove it works on Twitch.
4. Start a short `docs/BUILD_LOG.md`: a few lines per milestone on what we did and decided. I'll use it for the "how I used Codex" part of the submission.

Keep the design tight enough that I can review it in 15–20 minutes. Then stop and wait for my go-ahead.

## After I approve (Phase 2)

We build milestone by milestone in this thread: tests passing at each step, the README kept up to date, small commits, no secrets committed. If parts are independent (overlay, OBS bridge, simulator), feel free to split them across subagents, but keep integration and final testing here. This thread's session ID is what I submit, so most of the work should happen in it.