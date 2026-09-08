import React from 'react';
import { render } from '@testing-library/react';
import { expect, it } from 'vitest';
import { JournalDraftGuard } from '@/renderer/features/today/JournalDraftGuard';
import { useJournalStore } from '@/renderer/features/today/journalStore';

it('guards a failed draft even when no journal panel is mounted',()=>{
  useJournalStore.setState({drafts:{'/past-day':{original:'Old',text:'Unsaved',status:'error',error:'Conflict'}}});
  render(<JournalDraftGuard/>);
  const event=new Event('beforeunload',{cancelable:true});
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  useJournalStore.setState({drafts:{}});
});
