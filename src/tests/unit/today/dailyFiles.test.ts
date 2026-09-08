import { beforeEach, expect, it, vi } from 'vitest';
import { createDay, loadDay } from '@/renderer/features/today/dailyFiles';
import { installDiskApi } from '@/tests/helpers/diskApi';

beforeEach(()=>{
  installDiskApi({readDirectory:vi.fn().mockResolvedValue({success:true,data:{path:'/vault/Inbox/Logs',entries:[]}})});
});
it('does not overwrite a routine that writes after day creation', async()=>{
  window.markdownAPI = {
    read:vi.fn().mockResolvedValueOnce({success:true,data:{body:'Template'}}).mockResolvedValueOnce({success:true,data:{body:'## Activity Log\n- new routine event',revision:'r'}}),
    create:vi.fn().mockResolvedValue({success:true,data:{path:'/vault/Inbox/Logs/2026-09-08.md'}}),
    write:vi.fn().mockResolvedValue({success:true,data:{revision:'saved'}}),
  };
  await createDay('/vault','2026-09-08');
  expect(window.markdownAPI.write).not.toHaveBeenCalled();
});
it('excludes linked and dated photos resolving to another opened root', async()=>{
  installDiskApi({
    readDirectory:vi.fn(async folder=>({success:true as const,data:{path:folder,entries:folder.endsWith('/Logs') ? [{path:'/vault/Inbox/Logs/2026-09-08.md',name:'2026-09-08.md',kind:'markdown' as const,isDirectory:false,size:1,mtimeMs:1}] : folder.includes('/Photos/') ? [{path:'/other/date.jpg',name:'date.jpg',kind:'image' as const,isDirectory:false,size:1,mtimeMs:1}] : []}})),
    stat:vi.fn(async()=>({success:true as const,data:{path:'/other/private.jpg',name:'private.jpg',kind:'image' as const,isDirectory:false,size:1,mtimeMs:1}})),
  });
  window.markdownAPI={read:vi.fn().mockResolvedValue({success:true,data:{body:'![[Photos/link.jpg]]',path:'/vault/Inbox/Logs/2026-09-08.md',revision:'r'}}),write:vi.fn(),create:vi.fn()};
  expect((await loadDay('/vault','2026-09-08')).photos).toEqual([]);
});
