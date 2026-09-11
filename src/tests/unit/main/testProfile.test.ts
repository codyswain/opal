import { describe, expect, it, vi } from 'vitest';
import { applyTestProfile } from '@/main/testProfile';

function fakeApp() {
  return { setPath: vi.fn<(name: string, value: string) => void>() };
}

describe('applyTestProfile', () => {
  it('points Electron user data and session data at the test directory', () => {
    const app = fakeApp();
    expect(applyTestProfile({ OPAL_TEST_USER_DATA_DIR: '/tmp/opal-test' }, app)).toBe('/tmp/opal-test');
    expect(app.setPath.mock.calls).toEqual([
      ['userData', '/tmp/opal-test'],
      ['sessionData', '/tmp/opal-test'],
    ]);
  });
  it('leaves the real profile alone when the variable is unset or blank', () => {
    const app = fakeApp();
    expect(applyTestProfile({}, app)).toBeNull();
    expect(applyTestProfile({ OPAL_TEST_USER_DATA_DIR: '  ' }, app)).toBeNull();
    expect(app.setPath).not.toHaveBeenCalled();
  });
});
