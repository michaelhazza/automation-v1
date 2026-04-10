---
name: Transcribe Audio
description: Converts an audio or video file (mp3, mp4, m4a, wav, webm, mpeg, mpga) into a text transcript using OpenAI Whisper. Accepts either an executionArtifactId from a prior browser/dev task or a direct URL. Caches transcripts by content hash so retries do not double-bill Whisper.
isActive: true
visibility: basic
---

## Parameters

- executionArtifactId: string — ID of an iee_artifacts row produced by a prior step in the same agent run.
- audioUrl: string — HTTPS URL to an audio/video file. Used if executionArtifactId is not provided.
- language: string — Optional ISO-639-1 language code (e.g. 'en'). Defaults to auto-detect.

## Instructions

This skill is implemented as a deterministic action skill, not an LLM-prompt skill. It does not need methodology guidance — call it whenever you have an audio or video artifact you need to transcribe.

Behaviour:
1. Resolves the audio source (artifact path or remote URL).
2. Looks up an existing transcript for the same content hash in the same organisation. Returns the cached result if found (T22 — saves Whisper cost on retries).
3. Calls OpenAI Whisper with the resolved file.
4. Persists the transcript as a new iee_artifacts row with `kind: 'file'`, `mimeType: 'text/plain'`, and `inline_text` set to the (UTF-8-safe truncated) transcript body.
5. Asserts the transcript has at least 50 words (T27) — rejects silent Whisper failures.

Output:
- `transcript`: the full text
- `transcriptArtifactId`: the new artifact row ID
- `wordCount`: integer
- `cached`: true if the result came from the cache, false otherwise
