import type { DocumentState, RecoverySnapshot } from "../types";

export function recoverySnapshotFor(
  document: DocumentState,
  updatedAtMillis: number,
): RecoverySnapshot {
  return {
    id: document.id,
    path: document.path,
    name: document.name,
    source: document.source,
    savedSource: document.savedSource,
    revision: document.revision,
    selectionFrom: document.selectionFrom,
    selectionTo: document.selectionTo,
    scrollTop: document.scrollTop,
    updatedAtMillis,
  };
}

export function sameRecoveryContent(
  left: RecoverySnapshot,
  right: RecoverySnapshot,
): boolean {
  return left.path === right.path
    && left.name === right.name
    && left.source === right.source
    && left.savedSource === right.savedSource
    && left.revision?.hash === right.revision?.hash
    && left.selectionFrom === right.selectionFrom
    && left.selectionTo === right.selectionTo
    && left.scrollTop === right.scrollTop;
}
