import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { TodayRoute } from '@/renderer/features/today/TodayRoute';
import { discoverVaults, loadDay, type DayData } from '@/renderer/features/today/dailyFiles';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { installDiskApi } from '@/tests/helpers/diskApi';

vi.mock('@/renderer/features/shell',()=>({useShell:()=>({navigateFiles:vi.fn()})}));
vi.mock('@/renderer/features/today/dailyFiles',()=>({discoverVaults:vi.fn(),loadDay:vi.fn(),createDay:vi.fn()}));
const empty: DayData = {document:null,brief:'',digestPath:null,tasks:[],candidates:[],photos:[],warnings:[]};
beforeEach(()=>{
  localStorage.clear();
  installDiskApi({listRoots:vi.fn().mockResolvedValue({success:true,data:['/vault']})});
  useDiskStore.setState({roots:['/vault']});
  vi.mocked(discoverVaults).mockResolvedValue(['/vault']);
  vi.mocked(loadDay).mockResolvedValue(empty);
});
it('offers explicit creation for a missing day and does not create on navigation', async()=>{
  render(<TodayRoute/>);
  expect(await screen.findByRole('button',{name:'Start this day’s journal'})).toBeInTheDocument();
  expect(screen.getByText('No activity recorded for this day. Entries from your routines will appear here.')).toBeInTheDocument();
});
it('never displays the previous day under a new date while loading', async()=>{
  vi.mocked(loadDay).mockResolvedValue({...empty,brief:'Only yesterday'});
  render(<TodayRoute/>);
  await screen.findByText('Only yesterday');
  vi.mocked(loadDay).mockImplementation(()=>new Promise(()=>undefined));
  fireEvent.click(screen.getByRole('button',{name:'Previous day'}));
  expect(screen.queryByText('Only yesterday')).not.toBeInTheDocument();
});
it('persists privacy after the shortcut and hides associated photos', async()=>{
  render(<TodayRoute/>);
  await screen.findByText('Photos are hidden with your journal.');
  act(()=>{fireEvent.keyDown(window,{key:'j',ctrlKey:true,shiftKey:true});});
  await waitFor(()=>expect(localStorage.getItem('opal.today.journal-hidden')).toBe('false'));
  expect(screen.queryByText('Photos are hidden with your journal.')).not.toBeInTheDocument();
});
