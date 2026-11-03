import { safeLog, sanitizeLogFields, setSafeLogSink } from './safe-log';

describe('safe logging', () => {
  it('keeps operational tokens and drops statement content', () => {
    const statementBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    const sanitized = sanitizeLogFields({
      phase: 'ready',
      status: 'ready',
      revision: 3,
      code: 'network',
      fileName: 'statement.pdf',
      bytes: statementBytes,
      description: 'StreamBeam monthly',
      merchant: 'BrightGrid',
      scenario: 'statement.pdf',
      body: '%PDF-1.7 secret',
      path: 'file:///cache/statement.pdf',
    });

    expect(sanitized).toEqual({
      phase: 'ready',
      status: 'ready',
      revision: 3,
      code: 'network',
    });
    expect(JSON.stringify(sanitized)).not.toMatch(/statement|StreamBeam|BrightGrid|PDF|secret/i);
  });

  it('does not emit the dropped fields through the sink', () => {
    const seen: unknown[] = [];
    setSafeLogSink((event, fields) => {
      seen.push({ event, fields });
    });

    safeLog('import', {
      phase: 'processing',
      fileName: 'Выписка.csv',
      description: 'Netflix',
      bytes: 'raw-bytes',
    });

    expect(seen).toEqual([{ event: 'import', fields: { phase: 'processing' } }]);
    setSafeLogSink(() => undefined);
  });
});
