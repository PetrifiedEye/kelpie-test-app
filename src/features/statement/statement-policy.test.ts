import { closeSync, openSync, readSync, statSync } from 'node:fs';
import path from 'node:path';

import {
  MAX_STATEMENT_BYTES,
  detectStatementFormat,
  formatStatementSize,
  isOwnedStatementCopy,
  isPickerTemporaryCopy,
  statementFormatLabel,
} from './statement-policy';

const fixtures = path.resolve(__dirname, '../../../../mobile-engineer-kit/fixtures');

function readPrefix(fileName: string): Uint8Array {
  const filePath = path.join(fixtures, fileName);
  const fd = openSync(filePath, 'r');
  const buffer = Buffer.alloc(64);
  const count = readSync(fd, buffer, 0, 64, 0);
  closeSync(fd);
  return new Uint8Array(buffer.subarray(0, count));
}

describe('detectStatementFormat', () => {
  it('accepts a PDF by its signature', () => {
    expect(detectStatementFormat(readPrefix('statement.pdf'))).toBe('pdf');
    expect(statSync(path.join(fixtures, 'statement.pdf')).size).toBeLessThanOrEqual(MAX_STATEMENT_BYTES);
  });

  it('rejects a renamed text file even when it is called a pdf', () => {
    expect(() => detectStatementFormat(readPrefix('spoofed.pdf'))).toThrow(
      'Expected a PDF signature or the exact CSV header.',
    );
  });

  it('accepts the exact CSV header and a UTF-8 BOM', () => {
    expect(detectStatementFormat(readPrefix('statement.csv'))).toBe('csv');
    const header = 'date,description,amount\n';
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...Buffer.from(header)]);
    expect(detectStatementFormat(bom)).toBe('csv');
  });

  it('rejects a different header, extension, and an empty file', () => {
    expect(() => detectStatementFormat(new Uint8Array(Buffer.from('Date,Description,Amount\n')))).toThrow(
      /CSV header/,
    );
    expect(() => detectStatementFormat(new Uint8Array())).toThrow(/CSV header/);
  });
});

describe('statement presentation', () => {
  it('labels the detected format and shows the exact size', () => {
    expect(statementFormatLabel('pdf')).toBe('PDF');
    expect(statementFormatLabel('csv')).toBe('CSV');
    expect(formatStatementSize(112)).toBe('112 bytes');
    expect(formatStatementSize(2048)).toBe('2.0 KiB (2048 bytes)');
    expect(formatStatementSize(MAX_STATEMENT_BYTES)).toBe('10 MiB (10485760 bytes)');
  });
});

describe('temporary copy locations', () => {
  const cache = 'file:///data/cache/statement-imports';

  it('owns only a direct file inside the private cache directory', () => {
    expect(isOwnedStatementCopy(`${cache}/job.statement`, cache)).toBe(true);
    expect(isOwnedStatementCopy('file:///data/cache/other/job.statement', cache)).toBe(false);
    expect(isOwnedStatementCopy(`${cache}/../secret`, cache)).toBe(false);
    expect(isOwnedStatementCopy('content://documents/statement.csv', cache)).toBe(false);
  });

  it('treats picker inbox copies as releasable and leaves content URIs alone', () => {
    expect(isPickerTemporaryCopy('file:///private/var/mobile/tmp/Inbox/statement.csv')).toBe(true);
    expect(isPickerTemporaryCopy('file:///cache/DocumentPicker/statement.csv')).toBe(true);
    expect(isPickerTemporaryCopy('content://com.android.externalstorage.documents/document/primary:statement.csv')).toBe(
      false,
    );
    expect(isPickerTemporaryCopy('file:///storage/emulated/0/Download/statement.csv')).toBe(false);
  });
});
