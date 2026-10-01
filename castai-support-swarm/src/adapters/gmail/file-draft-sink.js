import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * File-backed DraftSink: writes the draft (plus optional ledger/verdict
 * artifacts) to `<outDir>/<caseId>/`.
 *
 * - draft.md     — content is exactly draftPost.body
 * - ledger.json  — written only when draftPost.ledger is present
 * - verdict.json — written only when draftPost.verdict is present
 *
 * Refuses caseIds containing '..' or path separators ('/' or '\') so a
 * hostile caseId cannot escape outDir.
 *
 * @implements {import('./draft-sink.js').DraftSink}
 */
export class FileDraftSink {
  /**
   * @param {{outDir: string}} options
   */
  constructor({ outDir }) {
    this.outDir = outDir;
  }

  /**
   * @param {import('../../core/types.js').DraftPost & {ledger?: object, verdict?: object}} draftPost
   * @returns {Promise<{path: string}>} absolute path of the written draft.md
   */
  async save(draftPost) {
    const caseId = draftPost?.caseId;
    if (typeof caseId !== 'string' || caseId.length === 0) {
      throw new Error('FileDraftSink.save requires draftPost.caseId (non-empty string)');
    }
    if (caseId.includes('..') || caseId.includes('/') || caseId.includes('\\')) {
      throw new Error(`FileDraftSink.save refuses unsafe caseId: ${caseId}`);
    }

    const caseDir = path.join(this.outDir, caseId);
    await mkdir(caseDir, { recursive: true });

    const draftPath = path.join(caseDir, 'draft.md');
    await writeFile(draftPath, draftPost.body, 'utf8');

    if (draftPost.ledger !== undefined) {
      await writeFile(path.join(caseDir, 'ledger.json'), JSON.stringify(draftPost.ledger, null, 2), 'utf8');
    }
    if (draftPost.verdict !== undefined) {
      await writeFile(path.join(caseDir, 'verdict.json'), JSON.stringify(draftPost.verdict, null, 2), 'utf8');
    }

    return { path: draftPath };
  }
}
