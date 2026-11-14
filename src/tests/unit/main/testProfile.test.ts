import { describe, expect, it, vi } from 'vitest';
import { agentLookup, applyTestProfile } from '@/main/testProfile';

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

describe('agentLookup', () => {
  const env = { OPAL_TEST_USER_DATA_DIR: '/tmp/opal-test', OPAL_TEST_AGENT_HOME: '/tmp/home', OPAL_TEST_AGENT_PATH: '/tmp/bin' };
  it('moves the command lookup to a temp home and PATH only for an unpackaged test run', () => {
    expect(agentLookup(env, false)).toEqual({ home: '/tmp/home', path: '/tmp/bin' });
    expect(agentLookup(env, true)).toBeNull();
    expect(agentLookup({ ...env, OPAL_TEST_USER_DATA_DIR: '' }, false)).toBeNull();
    expect(agentLookup({ ...env, OPAL_TEST_AGENT_PATH: undefined }, false)).toBeNull();
  });
});
