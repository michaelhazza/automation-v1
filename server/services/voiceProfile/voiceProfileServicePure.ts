import type { VoiceProfileState } from '../../../shared/types/voiceProfile.js';

// Sample shape — never persisted, lives only in memory
export interface VoiceSample {
  text: string;
  source: string;
  sampledAt: string;
}

// Distilled features — what gets persisted
export interface VoiceFeatures {
  greetingFrequency: Record<string, number>;       // "Hi" -> 0.6
  signoffFrequency: Record<string, number>;        // "Thanks" -> 0.4
  averageSentenceLength: number;                   // words
  sentenceLengthStdev: number;
  formalityScore: number;                          // 0..1
  emDashUsage: number;                             // per 100 sentences
  commonPhrases: Array<{ phrase: string; count: number }>;
  signature: string | null;
}

/**
 * Distil voice features from raw samples. Deterministic — same samples in
 * any order produce same features.
 */
export function distilFeatures(samples: ReadonlyArray<VoiceSample>): VoiceFeatures {
  if (samples.length === 0) {
    return {
      greetingFrequency: {},
      signoffFrequency: {},
      averageSentenceLength: 0,
      sentenceLengthStdev: 0,
      formalityScore: 0,
      emDashUsage: 0,
      commonPhrases: [],
      signature: null,
    };
  }

  const greetingPatterns = ['Hi', 'Hello', 'Hey', 'Dear', 'Greetings', 'Good morning', 'Good afternoon'];
  const signoffPatterns = ['Thanks', 'Best', 'Regards', 'Cheers', 'Sincerely', 'Thank you', 'Best regards', 'Kind regards'];

  const greetingCounts: Record<string, number> = {};
  const signoffCounts: Record<string, number> = {};
  const sentenceLengths: number[] = [];
  let totalEmDashes = 0;
  let totalSentences = 0;
  let formalCount = 0;
  const phraseCounts = new Map<string, number>();

  // Sort samples by sampledAt so derivation order is deterministic
  const sortedSamples = [...samples].sort((a, b) => a.sampledAt.localeCompare(b.sampledAt));

  for (const sample of sortedSamples) {
    const text = sample.text;
    const sentences = text.split(/[.!?]+/).map(s => s.trim()).filter(Boolean);

    for (const greeting of greetingPatterns) {
      if (text.trimStart().startsWith(greeting)) {
        greetingCounts[greeting] = (greetingCounts[greeting] ?? 0) + 1;
        break;
      }
    }

    for (const signoff of signoffPatterns) {
      if (text.trimEnd().split('\n').some(line => line.trim().startsWith(signoff))) {
        signoffCounts[signoff] = (signoffCounts[signoff] ?? 0) + 1;
        break;
      }
    }

    for (const s of sentences) {
      const words = s.split(/\s+/).filter(Boolean);
      sentenceLengths.push(words.length);
      totalEmDashes += (s.match(/—/g) ?? []).length;
      totalSentences += 1;
      if (/\b(however|therefore|furthermore|consequently|please|kindly|appreciate)\b/i.test(s)) {
        formalCount += 1;
      }
      // 3-word phrases (for common phrases)
      for (let i = 0; i < words.length - 2; i++) {
        const phrase = words.slice(i, i + 3).join(' ').toLowerCase();
        if (phrase.length > 8) {
          phraseCounts.set(phrase, (phraseCounts.get(phrase) ?? 0) + 1);
        }
      }
    }
  }

  const totalSamples = sortedSamples.length;
  const greetingFrequency: Record<string, number> = {};
  for (const [k, v] of Object.entries(greetingCounts)) greetingFrequency[k] = v / totalSamples;
  const signoffFrequency: Record<string, number> = {};
  for (const [k, v] of Object.entries(signoffCounts)) signoffFrequency[k] = v / totalSamples;

  const avg = sentenceLengths.length > 0
    ? sentenceLengths.reduce((a, b) => a + b, 0) / sentenceLengths.length
    : 0;
  const variance = sentenceLengths.length > 0
    ? sentenceLengths.reduce((sum, n) => sum + (n - avg) ** 2, 0) / sentenceLengths.length
    : 0;
  const stdev = Math.sqrt(variance);

  const formalityScore = totalSentences > 0 ? formalCount / totalSentences : 0;
  const emDashUsage = totalSentences > 0 ? (totalEmDashes * 100) / totalSentences : 0;

  const commonPhrases = [...phraseCounts.entries()]
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 10)
    .map(([phrase, count]) => ({ phrase, count }));

  return {
    greetingFrequency,
    signoffFrequency,
    averageSentenceLength: avg,
    sentenceLengthStdev: stdev,
    formalityScore,
    emDashUsage,
    commonPhrases,
    signature: null,
  };
}

/**
 * Should a profile be refreshed now?
 * - 'manual' → never auto-refresh (short-circuits immediately; no state check needed)
 * - 'periodic' → if last_derived_at + (refresh_config.days) days < now
 * - 'on_send_count' → V1 returns false (deferred per spec)
 *
 * State-filter responsibility: the nightly job (voiceProfileRefreshJob)
 * excludes state='failed' profiles in the DB candidate query. This function
 * does NOT need a parallel failed-state check — the manual short-circuit
 * already covers the only path where a failed profile could reach this call.
 */
export function shouldRefresh(args: {
  refreshPolicy: 'manual' | 'periodic' | 'on_send_count';
  refreshConfig: { days?: number } | null;
  lastDerivedAt: Date | null;
  now: Date;
}): boolean {
  if (args.refreshPolicy === 'manual') return false;
  if (args.refreshPolicy === 'on_send_count') return false;
  if (args.refreshPolicy === 'periodic') {
    if (!args.lastDerivedAt) return true;
    const days = args.refreshConfig?.days ?? 30;
    const elapsed = (args.now.getTime() - args.lastDerivedAt.getTime()) / (1000 * 60 * 60 * 24);
    return elapsed >= days;
  }
  return false;
}

/**
 * Test if a state transition is legal per the state machine:
 * pending → deriving → ready | failed; failed → pending → deriving (manual retry)
 */
export function canTransitionState(from: VoiceProfileState, to: VoiceProfileState): boolean {
  const legal: Record<VoiceProfileState, VoiceProfileState[]> = {
    pending: ['deriving'],
    deriving: ['ready', 'failed'],
    ready: ['deriving'],     // refresh path
    failed: ['pending'],     // manual retry path
  };
  return legal[from]?.includes(to) ?? false;
}
