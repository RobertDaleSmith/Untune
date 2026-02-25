export interface LyricLine {
  time: number;
  text: string;
}

/**
 * Parse LRC format lyrics into an array of timed lines.
 * Handles [MM:SS.XX] and [MM:SS.XXX] formats.
 */
export function parseLRC(lrc: string): LyricLine[] {
  const lines: LyricLine[] = [];
  const regex = /\[(\d{1,3}):(\d{2})\.(\d{2,3})\]\s*(.*)/;

  for (const raw of lrc.split("\n")) {
    const match = raw.match(regex);
    if (!match) continue;
    const minutes = parseInt(match[1], 10);
    const seconds = parseInt(match[2], 10);
    const msStr = match[3];
    const ms = msStr.length === 2 ? parseInt(msStr, 10) * 10 : parseInt(msStr, 10);
    const time = minutes * 60 + seconds + ms / 1000;
    const text = match[4].trim();
    if (text.length > 0) {
      lines.push({ time, text });
    }
  }

  lines.sort((a, b) => a.time - b.time);
  return lines;
}

/**
 * Binary search to find the index of the current lyric line
 * given the playback position in seconds.
 * Returns -1 if position is before the first line.
 */
export function findCurrentLineIndex(lines: LyricLine[], positionSecs: number): number {
  if (lines.length === 0) return -1;
  if (positionSecs < lines[0].time) return -1;

  let lo = 0;
  let hi = lines.length - 1;

  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (lines[mid].time <= positionSecs) {
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return hi;
}
