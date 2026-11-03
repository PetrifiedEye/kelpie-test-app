import { chargesVisible } from './report-visibility';

describe('report visibility', () => {
  it('shows the ready charges and keeps them while deletion is unfinished', () => {
    expect(chargesVisible('ready', true)).toBe(true);
    expect(chargesVisible('deleting', true)).toBe(true);
    expect(chargesVisible('error', true)).toBe(true);
  });

  it('hides charges before the report exists and after the import is deleted', () => {
    expect(chargesVisible('ready', false)).toBe(false);
    expect(chargesVisible('queued', true)).toBe(false);
    expect(chargesVisible('processing', true)).toBe(false);
    expect(chargesVisible('deleted', true)).toBe(false);
    expect(chargesVisible('confirmation', true)).toBe(false);
  });
});
