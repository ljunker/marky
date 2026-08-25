import type { WorkspaceFile } from "../types";

export interface QuickOpenCandidate extends WorkspaceFile {
  isOpen: boolean;
  recentRank: number | null;
}

export function rankQuickOpen(
  candidates: QuickOpenCandidate[],
  query: string,
  limit = 100,
): QuickOpenCandidate[] {
  const normalizedQuery = normalize(query.trim());
  return candidates
    .map((candidate) => ({
      candidate,
      score: normalizedQuery
        ? fuzzyScore(
            `${candidate.name} ${candidate.relativePath}`,
            normalizedQuery,
          )
        : 0,
    }))
    .filter(({ score }) => !normalizedQuery || score !== null)
    .sort((left, right) => {
      if (normalizedQuery) {
        const scoreDifference = (right.score ?? 0) - (left.score ?? 0);
        if (scoreDifference) return scoreDifference;
      }
      const leftRecent = left.candidate.recentRank ?? Number.MAX_SAFE_INTEGER;
      const rightRecent = right.candidate.recentRank ?? Number.MAX_SAFE_INTEGER;
      if (leftRecent !== rightRecent) return leftRecent - rightRecent;
      if (left.candidate.isOpen !== right.candidate.isOpen) {
        return left.candidate.isOpen ? -1 : 1;
      }
      return left.candidate.relativePath.localeCompare(
        right.candidate.relativePath,
        "de",
        { sensitivity: "base" },
      );
    })
    .slice(0, limit)
    .map(({ candidate }) => candidate);
}

function fuzzyScore(value: string, query: string): number | null {
  const normalized = normalize(value);
  const direct = normalized.indexOf(query);
  if (direct >= 0) {
    return 1_000 - direct * 2 - (normalized.length - query.length) * 0.1;
  }
  let score = 0;
  let cursor = 0;
  let previous = -1;
  for (const character of query) {
    const found = normalized.indexOf(character, cursor);
    if (found < 0) return null;
    score += previous < 0 ? 10 : Math.max(1, 12 - (found - previous));
    if (found === 0 || /[\s/_.-]/.test(normalized[found - 1] ?? "")) score += 8;
    previous = found;
    cursor = found + 1;
  }
  return score - normalized.length * 0.05;
}

const normalize = (value: string): string =>
  value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase("de");
