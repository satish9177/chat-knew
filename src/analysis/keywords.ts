import type { Claim } from '../types.js';

/** Explicit fallback phrases only; no claim of general multilingual understanding. */
export function keywordClaim(text: string): Claim | null {
  const normalized = text.normalize('NFKC').toLocaleLowerCase('en').replace(/[’‘]/g, "'");
  if (/\b(not muted|aren't muted|isn't muted|can hear you|audio is fine|mic is fine)\b/u.test(normalized)) return null;
  if (/\b(brb|starting soon|ending screen|away screen)\b/u.test(normalized)) return 'AWAY_SCENE';
  if (/\b(muted|can't hear (you|anything)|cannot hear (you|anything)|no audio|no sound|silent cinema|awaaz nahi aa rahi|awaz nahi aa rahi|no se oye|sem áudio)\b/u.test(normalized)
    || normalized.includes('आवाज़ नहीं आ रही') || normalized.includes('आवाज नहीं आ रही')) return 'AUDIO_MISSING';
  return null;
}
