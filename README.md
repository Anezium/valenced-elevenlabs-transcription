# ElevenLabs Transcription for Valenced

Version `0.2.2`, experimental, NOT validated on Android and NOT validated end to end with ElevenLabs/Discord. This release is not a device certification. Versions `0.1.0`, `0.2.0-dev` and `0.2.1` remain available, with their tags and assets untouched.

`0.2.2` redesigns the settings screen following a UI/UX review: a status line that always says what to do next, a single API key row with Add/Replace/Remove, manual and automatic transcription grouped separately, the automatic options and the diagnostics in collapsible sections (the automatic summary row always shows Off / On / Unavailable), and shorter wording in the voice-message sheet. The consent model, limits, native bridge and the double-send warning are unchanged. Developer caveats were moved out of the main screen; a short line “Not yet verified on a device” remains under Status and about. The UI and this README stay in English and the published reply is still labelled `Transcript:`. The version was bumped from `0.2.1` because the host updater offers an update only for a strictly higher version.

## Repository and updates

Keep exactly the index already added in Valenced:

https://raw.githubusercontent.com/Anezium/valenced-elevenlabs-transcription/main/index.json

The `latest` channel deliberately points to `0.2.2`, as do `testing` and `beta`. Here it designates the current stable release `0.2.2`. The host updater follows the channel registered for this repository; version 0.2.2 is higher than 0.2.1, 0.2.0-dev and 0.1.0 according to its comparator. No new index or URL change is needed. An older install from a file may not follow the repository: check its source in the plugin settings.

In Settings > Valenced > Plugins, refresh the repositories, then check the proposed update and confirm it. A reload may be necessary. None of these steps has been performed on a phone for this publication; the exact presentation depends on the host.

Alternative, plugin ZIP without extraction:
https://github.com/Anezium/valenced-elevenlabs-transcription/releases/download/v0.2.2/anezium.elevenlabs-transcription@0.2.2.zip

The source ZIP is NOT installable as a plugin. SHA256 of the plugin ZIP (47,328 bytes):
`fcf170039e2a02f5bce0c9503cea040173933dfdf62a9f3e3f99b8449e774ec1`.

## Target and native bridge

Discord `352.6 (35220600000000) - canaryRelease`, details `App: 352.6 (352206) canaryRelease`. Target Valenced source `d3e17fe0416c3dc5f4b4d783b465eeb4a99caec1`, API `1.0.0`. Dependencies are strict: `discord =352.6`, `valenced.api =1.0.0`, complemented by runtime guards and module uniqueness/shape checks.

The same ZIP includes `index.js` AND `elevenlabs.jar` containing DEX. The manifest declares `dist.android.path` and `dist.android.class`; the official loader can load this PluginBuilder from an external plugin. No modified APK or separately installed bridge is required by this source contract. This is NOT proof that this bridge runs on the user's phone. Missing bridge, context or expected module = fail closed, with no plaintext fallback storage.

## Features and consents

- Key: hidden field in the settings, saved/deleted through the Android bridge; AES-256-GCM, non-exportable AndroidKeyStore key, ciphertext/IV in noBackupFilesDir via AtomicFile. Never give your key in a chat/report. Persistence after an Android process kill remains to be verified on a device.
- Manual action kept for an existing voice message, with consent to external processing/cost. Insertion into the native group is refused if its structure is not recognized; actual position/icon not validated.
- Automation is off by default. Separate explicit consents for transfer/cost and for publishing your own transcripts. Saving the key does not enable these consents and does not verify the key with the provider.
- New voice messages in the selected channel only; no history collection and no catch-up. Others' messages: rendered locally in the chat, never published by the plugin. Your SENT voice messages: text reply referencing the original in the original channel after explicit activation, mentions disabled. Published replies start with `Transcript:`.
- Bounded queue, permission check before cost and sending, durable deduplication. At most one automatic attempt, NO exactly-once delivery guarantee. Journal limited to 1024 reservations; a full journal = fail closed, with no automatic rotation.

## Privacy and limits

A local result is not local processing: the audio is sent to ElevenLabs, potentially paid. Scribe v2, retention/cost depending on the provider plan; no zero-retention promise. Permission from the people concerned is required. Application caps: 8 MiB / 5 minutes; in-memory cache of 10 results, automatic queue of 8 pending + 1 active, 3 attempts/minute.

Keystore protection concerns data at rest, not isolation between plugins of the same UID/process, nor a hardware guarantee. The key stays in memory during processing. Cache cleanup in finally and at startup; a failed purge = fail closed. No Discord token is added to the audio/STT transport. The RN/XHR transport guarantees neither prior native blocking of every redirect nor a strict memory cap before allocation.

Background, stop, key/account/channel change or revocation invalidate in-flight jobs. A request already sent cannot be recalled; cost or publication already committed remain possible. If the disk refuses a revocation, it holds for the session but the old consents may reappear after a crash/restart: the UI warns, retry before leaving. Do not automatically resend an uncertain reply.

## Verification and caveats

Rebuild of the exact candidate: typecheck, 56 TS tests, 59 tests of the real bundle with a synthetic host, 2 extra UI probes, 41 JVM assertions, compilation against the real host API, Kotlin and D8 successful. Vendor/secrets audit and Fable provenance verified; npm audit with no reported vulnerability. A pattern scan is not absolute proof of the absence of secrets. All of these checks were re-run for 0.2.2 with `npm run verify` (typecheck, 56 TS tests, 59 real-bundle tests, 41 JVM assertions, native build against the pinned host source, deterministic package).

UI actually generated by `claude-fable-5-1` / effort high with no substitution; its run ended on HTTP429, not on a final success. Fixes and the build were verified independently. The 0.2.1 texts are an English translation of that UI; 0.2.2 reworks the settings screen after a separate read-only UI/UX review.

NOT verified: AndroidKeyStore/AtomicFile on a device, real Android stop/reload, menu 352.6, visual/mobile/TalkBack rendering, real client hooks and an actual Discord reply. No device install, user audio, paid STT call or Discord POST was run in this publication. Synthetic tests prove none of these points. Final v0.2 validation remains open; any real test requires a separate agreement.

## Stopping and rollback

Disable the automatic modes, then use “Remove key” (Settings > API key; it also cancels transfers and clears local transcripts) before uninstalling the plugin. The vault and the Keystore alias may survive uninstalling the plugin alone. No forensic erasure promise. Clear the clipboard if a result was copied; messages already published are not removed automatically.

The `legacy` channel keeps 0.1.0, as well as the original download:
https://github.com/Anezium/valenced-elevenlabs-transcription/releases/download/v0.1.0/anezium.elevenlabs-transcription@0.1.0.zip

A downgrade may require manual version selection depending on the host; it is not tested here. Do not delete data to work around an error.

## Build and sources

Node >=22.18 (verified 22.21.1), Python >=3.11. Local toolchain only, see V020_TECHNICAL.md and scripts/setup-native.py for versions/hashes/licenses. Obtain the official Valenced source at the target commit and set VALENCED_SOURCE to its checkout.

    python3 scripts/setup-native.py
    npm ci --ignore-scripts --legacy-peer-deps
    npm run verify
    node scripts/audit-dev.mjs
    npm audit --audit-level=high

Output: `dist/anezium.elevenlabs-transcription@0.2.2.zip`. `verify` does not modify the public index. The official CLI generates the index from the ZIPs and the explicit channels in repo.config.json. PREVIEW_020.md documents the distribution checks. V020_TECHNICAL.md and V020_DIAGNOSTIC.md keep the history of the steps, not the current authorization state; these engineering documents are still in French.

GPL-3.0-only, without warranty; attributions in NOTICE, external APIs and pinned vendored sources. No official affiliation with Discord, Valenced or ElevenLabs.
