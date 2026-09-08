import { beforeEach, expect, it, vi } from 'vitest';
import { useJournalStore } from '@/renderer/features/today/journalStore';

beforeEach(() => { useJournalStore.setState({drafts:{}}); });
it('can explicitly discard a conflicted draft and adopt the current file', async () => {
  window.markdownAPI={read:vi.fn().mockResolvedValue({success:true,data:{body:'Latest journal\n## Activity Log\nEvent',revision:'r'}}),write:vi.fn(),create:vi.fn()};
  useJournalStore.setState({drafts:{'/day':{original:'Old',text:'Mine',status:'error'}}});
  await useJournalStore.getState().reload('/day');
  expect(useJournalStore.getState().drafts['/day']).toMatchObject({text:'Latest journal\n',original:'Latest journal\n',status:'saved'});
  expect(window.markdownAPI.write).not.toHaveBeenCalled();
});
it('retains a failed draft and retries without replacing external journal text', async () => {
  window.markdownAPI = {read:vi.fn().mockResolvedValue({success:true,data:{body:'External',revision:'2'}}),write:vi.fn(),create:vi.fn()};
  const store = useJournalStore.getState();
  store.seed('/day','Old');
  store.edit('/day','Mine');
  await store.save('/day');
  expect(useJournalStore.getState().drafts['/day']).toMatchObject({text:'Mine',original:'Old',status:'error'});
  expect(window.markdownAPI.write).not.toHaveBeenCalled();
});
it('saves typing that arrives during an in-flight write', async () => {
  let finish: (value: unknown) => void = () => undefined;
  let disk = 'Old\n';
  window.markdownAPI = {read:vi.fn(async () => ({success:true as const,data:{body:disk,path:'/day',revision:'r',size:1,hasFrontmatter:false}})),write:vi.fn(async (_path,body) => { if(body==='First\n') await new Promise(resolve => {finish=resolve;}); disk=body; return {success:true as const,data:{revision:'r'}}; }),create:vi.fn()};
  const store = useJournalStore.getState();
  store.seed('/day','Old\n'); store.edit('/day','First');
  const saving = store.save('/day');
  await vi.waitFor(() => expect(window.markdownAPI.write).toHaveBeenCalled());
  store.edit('/day','Second'); finish(undefined); await saving;
  expect(disk).toBe('Second\n');
  expect(useJournalStore.getState().drafts['/day'].status).toBe('saved');
});
