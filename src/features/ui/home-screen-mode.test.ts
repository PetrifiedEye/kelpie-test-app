import { homeScreenMode } from './home-screen-mode';

describe('home screen mode', () => {
  it('shows loading until the saved operation is restored', () => {
    expect(homeScreenMode({ hydrated: false, phase: 'selection', hasOperation: false, hasError: false })).toBe(
      'loading',
    );
  });

  it('shows empty when nothing is selected', () => {
    expect(homeScreenMode({ hydrated: true, phase: 'selection', hasOperation: false, hasError: false })).toBe('empty');
  });

  it('shows a recoverable error without an operation', () => {
    expect(homeScreenMode({ hydrated: true, phase: 'error', hasOperation: false, hasError: true })).toBe('error');
  });

  it('keeps confirmation and later statuses distinct from the empty state', () => {
    expect(homeScreenMode({ hydrated: true, phase: 'confirmation', hasOperation: true, hasError: false })).toBe(
      'confirmation',
    );
    expect(homeScreenMode({ hydrated: true, phase: 'ready', hasOperation: true, hasError: false })).toBe('status');
    expect(homeScreenMode({ hydrated: true, phase: 'error', hasOperation: true, hasError: true })).toBe('status');
  });
});
