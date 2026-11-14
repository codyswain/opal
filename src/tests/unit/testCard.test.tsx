import * as React from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { DEFAULT_DAY_SIDEBAR_PREFERENCES, DaySidebar, useDaySidebarStore } from '@/renderer/features/day-sidebar';
import { DEFAULT_SHELL_PREFERENCES, ShellProvider, useShellStore } from '@/renderer/features/shell';
import { useVariant, useVariantsStore } from '@/renderer/features/variants';
import { VARIANTS, type VariantName } from '@/common/variants';
import { TooltipProvider } from '@/renderer/shared/ui';
import type { DailyTest, TestAnswer, VariantSides, VaultTest, VaultTestChange } from '@/types/dailyTest';
import type { VaultDay } from '@/types/day';
import type { VaultAPI } from '@/types/vault';
import { installActivityApi } from '@/tests/helpers/activityApi';
import { openedPath, resetTabs } from '@/tests/helpers/tabs';

const ROOT = '/Vault';
const TODAY = '2026-01-06';
/** A variant that exists only in these tests: the app's registry starts empty. */
const VARIANT = 'test-row-height' as VariantName;

const interfaceTest = (extra: Partial<DailyTest> = {}): DailyTest => ({
  id: 'row-height',
  title: 'Tighter rows in the file tree',
  question: 'Which tree is easier to scan?',
  kind: 'interface',
  variant: VARIANT,
  where: 'recent',
  a: { label: 'Current', path: null },
  b: { label: 'Tighter', path: null },
  ...extra,
});

const pageTest = (): DailyTest => ({
  id: 'summary',
  title: 'Two summaries',
  question: 'Which reads faster?',
  kind: 'page',
  variant: null,
  where: null,
  a: { label: 'Long', path: `${ROOT}/Notes/long.md` },
  b: { label: 'Short', path: `${ROOT}/Notes/short.md` },
});

const empty = (date: string): VaultDay => ({ date, daily: null, log: null, entries: [], documents: [], chats: [], recordings: [], people: [], digest: null });

let current: VaultTest | null;
let sides: VariantSides;
let testChanged: ((change: VaultTestChange) => void) | null;

function installVaultApi() {
  testChanged = null;
  const api: VaultAPI = {
    discover: vi.fn(async () => ({ success: true as const, data: [{ path: ROOT, name: 'Vault' }] })),
    createDay: vi.fn(async (_root: string, date: string) => ({ success: true as const, data: { path: `${ROOT}/Library/daily/${date}.mdo` } })),
    day: vi.fn(async (_root: string, date: string) => ({ success: true as const, data: empty(date) })),
    stack: vi.fn(async () => ({ success: false as const, error: 'No stacks here.' })),
    touchedWeek: vi.fn(async () => ({ success: false as const, error: 'No weeks here.' })),
    checkDigestItem: vi.fn(async () => ({ success: false as const, error: 'No digest.' })),
    onTouchedChanged: vi.fn(() => () => undefined),
    onDayChanged: vi.fn(() => () => undefined),
    test: vi.fn(async () => ({ success: true as const, data: current })),
    answerTest: vi.fn(async (_root: string, _date: string, id: string, choice: TestAnswer['choice'], reason: string) => {
      if (current?.test.kind === 'interface') {
        sides = choice === 'b' ? { [VARIANT]: 'b' } : {};
      }
      return { success: true as const, data: { answer: { version: 1 as const, id, choice, reason, answeredAt: '2026-01-06T10:00:00Z' }, sides } };
    }),
    variants: vi.fn(async () => ({ success: true as const, data: sides })),
    setVariant: vi.fn(async (name: string, side: 'a' | 'b') => {
      sides = side === 'b' ? { ...sides, [name]: 'b' } : {};
      return { success: true as const, data: sides };
    }),
    onTestChanged: vi.fn((callback: (change: VaultTestChange) => void) => {
      testChanged = callback;
      return () => {
        testChanged = null;
      };
    }),
  };
  (window as unknown as { vaultAPI: VaultAPI }).vaultAPI = api;
  return api;
}

function renderSidebar() {
  return render(
    <MemoryRouter initialEntries={['/files']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <TooltipProvider>
        <ShellProvider>
          <div style={{ height: 900, width: 300 }}>
            <DaySidebar width={300} />
          </div>
        </ShellProvider>
      </TooltipProvider>
    </MemoryRouter>,
  );
}

let api: VaultAPI;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 0, 6, 9, 0));
  window.localStorage.clear();
  installActivityApi();
  current = null;
  sides = {};
  api = installVaultApi();
  resetTabs();
  useShellStore.setState({ ...DEFAULT_SHELL_PREFERENCES, narrowLayout: false, narrowSidebarOpen: false });
  useDaySidebarStore.setState({ ...DEFAULT_DAY_SIDEBAR_PREFERENCES, pickedDay: null, lastDay: null, seenPath: null, narrowOpen: false });
  // Dependency injection: this build's registry stays empty; the tests know one variant.
  useVariantsStore.setState({ known: [VARIANT], sides: {}, loaded: false });
});

afterEach(() => {
  vi.useRealTimers();
});

const card = () => screen.getByRole('region', { name: "Today's test" });

describe('the variant registry and hook', () => {
  function Probe() {
    return <span data-testid="side">{useVariant(VARIANT)}</span>;
  }

  it('lists the roomy variant in this build', () => {
    expect(VARIANTS).toEqual(['roomy']);
  });

  it('is A until the variant is switched to B, as kept in the main process', async () => {
    sides = { [VARIANT]: 'b' };
    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId('side')).toHaveTextContent('b'));
    await act(async () => {
      await useVariantsStore.getState().set(VARIANT, 'a');
    });
    expect(screen.getByTestId('side')).toHaveTextContent('a');
    expect(api.setVariant).toHaveBeenCalledWith(VARIANT, 'a');
  });

  it('is A for a variant the build does not know, whatever the state file says', async () => {
    useVariantsStore.setState({ known: [] });
    sides = { [VARIANT]: 'b' };
    render(<Probe />);
    await waitFor(() => expect(api.variants).toHaveBeenCalled());
    expect(screen.getByTestId('side')).toHaveTextContent('a');
  });
});

describe('the test card', () => {
  it('is absent when there is no test', async () => {
    renderSidebar();
    await waitFor(() => expect(api.test).toHaveBeenCalledWith(ROOT, TODAY));
    expect(screen.queryByRole('region', { name: /test/i })).toBeNull();
  });

  it('shows the test above the other cards and switches the live app to B', async () => {
    current = { root: ROOT, date: TODAY, test: interfaceTest(), answer: null };
    const user = userEvent.setup();
    renderSidebar();
    const region = await screen.findByRole('region', { name: "Today's test" });
    expect(within(region).getByText('Tighter rows in the file tree')).toBeInTheDocument();
    expect(within(region).getByText('Which tree is easier to scan?')).toBeInTheDocument();
    const switcher = within(region).getByRole('radiogroup', { name: 'Version' });
    await waitFor(() => expect(within(switcher).getByRole('radio', { name: 'Current' })).toHaveAttribute('aria-checked', 'true'));
    await user.click(within(switcher).getByRole('radio', { name: 'Tighter' }));
    expect(api.setVariant).toHaveBeenCalledWith(VARIANT, 'b');
    await waitFor(() => expect(within(switcher).getByRole('radio', { name: 'Tighter' })).toHaveAttribute('aria-checked', 'true'));
    // `where: "recent"` takes the user to Recent.
    await waitFor(() => expect(openedPath()).toBeNull());
    expect(useVariantsStore.getState().sides).toEqual({ [VARIANT]: 'b' });
  });

  it('sends A, B or Neither with a reason, then shrinks to one line, and Change opens the form again', async () => {
    current = { root: ROOT, date: TODAY, test: interfaceTest(), answer: null };
    const user = userEvent.setup();
    renderSidebar();
    await screen.findByRole('region', { name: "Today's test" });
    const send = within(card()).getByRole('button', { name: 'Send' });
    expect(send).toBeDisabled();
    await user.click(within(card()).getByRole('button', { name: 'Tighter' }));
    await user.type(within(card()).getByPlaceholderText('Why?'), 'Easier to see more at once.');
    expect(send).toBeEnabled();
    await user.click(send);
    expect(api.answerTest).toHaveBeenCalledWith(ROOT, TODAY, 'row-height', 'b', 'Easier to see more at once.');
    await waitFor(() => expect(within(card()).getByText('You picked Tighter.')).toBeInTheDocument());
    expect(within(card()).queryByText('Which tree is easier to scan?')).toBeNull();
    expect(useVariantsStore.getState().sides).toEqual({ [VARIANT]: 'b' });

    await user.click(within(card()).getByRole('button', { name: 'Change' }));
    expect(within(card()).getByRole('button', { name: 'Tighter' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(card()).getByPlaceholderText('Why?')).toHaveValue('Easier to see more at once.');
    await user.click(within(card()).getByRole('button', { name: 'Neither' }));
    await user.click(within(card()).getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(within(card()).getByText('You picked neither.')).toBeInTheDocument());
    expect(useVariantsStore.getState().sides).toEqual({});
  });

  it('reads again when the tests folder changes', async () => {
    renderSidebar();
    await waitFor(() => expect(testChanged).not.toBeNull());
    current = { root: ROOT, date: TODAY, test: interfaceTest(), answer: null };
    act(() => testChanged?.({ root: ROOT }));
    expect(await screen.findByRole('region', { name: "Today's test" })).toBeInTheDocument();
  });

  it('says a test whose variant this build lacks needs a newer build, and offers no switch', async () => {
    current = { root: ROOT, date: TODAY, test: interfaceTest({ variant: 'later-variant' }), answer: null };
    renderSidebar();
    const region = await screen.findByRole('region', { name: "Today's test" });
    expect(within(region).getByText('This test needs a newer build of Opal.')).toBeInTheDocument();
    expect(within(region).queryByRole('radiogroup')).toBeNull();
    expect(within(region).queryByRole('button', { name: 'Send' })).toBeNull();
  });

  it('opens a page test’s side in this tab, with neither side on until one is opened', async () => {
    current = { root: ROOT, date: TODAY, test: pageTest(), answer: null };
    const user = userEvent.setup();
    renderSidebar();
    const region = await screen.findByRole('region', { name: "Today's test" });
    const radios = within(region).getAllByRole('radio');
    expect(radios.map((radio) => radio.getAttribute('aria-checked'))).toEqual(['false', 'false']);
    await user.click(within(region).getByRole('radio', { name: 'Short' }));
    expect(openedPath()).toBe(`${ROOT}/Notes/short.md`);
    await waitFor(() => expect(within(region).getByRole('radio', { name: 'Short' })).toHaveAttribute('aria-checked', 'true'));
    expect(api.setVariant).not.toHaveBeenCalled();
  });

  it('names an older unanswered test by its weekday', async () => {
    current = { root: ROOT, date: '2026-01-05', test: interfaceTest(), answer: null };
    renderSidebar();
    expect(await screen.findByRole('region', { name: 'Test from Mon' })).toBeInTheDocument();
  });
});
