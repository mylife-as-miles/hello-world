/**
 * Raid chip ("+40 raiders from CozyStreamer"): pure helpers (Node-safe, allocation-free).
 *
 * The number is ONE value per raid group, fixed for as long as the group exists: the raid's size as announced
 * (the raid event's `payload.amount`, the same number the "RAID! 40 viewers" banner shows), and never less than
 * the most visitor avatars this group has had on stage at once (`peak`, which covers raids without an amount).
 * It does not count who happens to stand near the chip right now (that read +12, +5, +14 for one 40-viewer raid).
 * It is never "+0": a group with nothing to show has no chip.
 */
export function raidChipCount(amount: unknown, peak: number): number {
  const a = typeof amount === 'number' && Number.isFinite(amount) ? Math.max(0, Math.round(amount)) : 0;
  return Math.max(a, Math.max(0, Math.floor(peak)));
}

/** Chip label, or '' when there is nothing to count (callers hide the chip then). */
export function raidChipText(count: number, channel: string): string {
  return count >= 1 ? `+${count} raiders from ${channel || 'a raid'}` : '';
}

/**
 * Densest cluster of a raid group: the member (index into xs/zs, n members) with the most group-mates within
 * `radius` m (itself included), preferring `prevIdx` (the previous anchor) unless another member beats it by 2+,
 * so the chip does not hop between sub-groups of the same size. Returns the anchor index and writes its member
 * count to out[0] (or -1 / 0 when n = 0).
 */
export function densestMember(xs: ArrayLike<number>, zs: ArrayLike<number>, n: number, radius: number, prevIdx: number, out: { count: number }): number {
  let best = -1, bestN = 0;
  const r2 = radius * radius;
  let prevN = -1;
  for (let i = 0; i < n; i++) {
    let k = 0;
    for (let j = 0; j < n; j++) { const dx = xs[j]! - xs[i]!, dz = zs[j]! - zs[i]!; if (dx * dx + dz * dz <= r2) k++; }
    if (i === prevIdx) prevN = k;
    if (k > bestN) { bestN = k; best = i; }
  }
  if (prevIdx >= 0 && prevIdx < n && prevN >= bestN - 1) { out.count = prevN; return prevIdx; }
  out.count = bestN;
  return best;
}
