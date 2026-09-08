import React, { useCallback, useEffect, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Eye, EyeOff, RefreshCw, Sun } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { focusFile } from '@/renderer/features/disk-explorer/navigation';
import { useShell } from '@/renderer/features/shell';
import { toOpalFileUrl } from '@/common/opalFileUrl';
import { completeTask, localDate, shiftDate, splitDailyLog, validDate, type DailyTask } from './dailyModel';
import { createDay, discoverVaults, loadDay, type DayData } from './dailyFiles';
import { JournalPanel } from './JournalPanel';
import './today.css';

function useLocalStorage(key: string, fallback: string): [string, (value: string) => void] {
  const [value, setValue] = useState(() => { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } });
  return [value, next => { setValue(next); try { localStorage.setItem(key, next); } catch { /* preference remains session-local */ } }];
}

function Markdown({children}: {children:string}) {
  return <div className="today-markdown prose prose-sm dark:prose-invert max-w-none"><ReactMarkdown remarkPlugins={[remarkGfm]}
    components={{img:()=>null, a:({children,href})=><span title={href}>{children}</span>}}>{children}</ReactMarkdown></div>;
}

export function TodayRoute() {
  const roots = useDiskStore(state => state.roots);
  const [vaults, setVaults] = useState<string[]>([]);
  const [discovering, setDiscovering] = useState(true);
  const [selectedRoot, selectRoot] = useLocalStorage('opal.today.vault', '');
  const [privacy, setPrivacy] = useLocalStorage('opal.today.journal-hidden', 'true');
  const hidden = privacy === 'true';
  const root = vaults.includes(selectedRoot) ? selectedRoot : vaults[0] ?? '';
  const [day, setDay] = useState(localDate);
  const [loaded, setData] = useState<(DayData & {scope:string}) | null>(null);
  const scope = `${root}:${day}`;
  const data = loaded?.scope === scope ? loaded : null;
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const { navigateFiles } = useShell();
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  const openSource = (path: string) => navigateFiles(focusFile(path.slice(0, path.lastIndexOf('/')), path));

  useEffect(() => { void useDiskStore.getState().loadRoots(); }, []);
  useEffect(() => {
    let alive = true;
    setDiscovering(true);
    void discoverVaults(roots).then(matches => { if (alive) { setVaults(matches); setDiscovering(false); } }).catch(() => {
      if (alive) {setError('Could not find your vault. Try opening the folder again.'); setDiscovering(false);}
    });
    return () => {alive=false;};
  }, [roots]);
  useEffect(() => {
    if (!root) {setData(null); setLoading(false); return;}
    let alive = true;
    setLoading(true); setError(null);
    void loadDay(root, day).then(next => {if(alive) setData({...next,scope:`${root}:${day}`});}).catch(reason => {if(alive) {setData(null);setError(reason instanceof Error ? reason.message : 'Could not read this day.');}}).finally(() => {if(alive) setLoading(false);});
    return () => {alive=false;};
  }, [root,day,revision]);
  useEffect(() => {
    if(!root) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = window.diskAPI.onChanged(({directories}) => {
      if(!directories.some(folder => folder === root || folder.startsWith(root+'/'))) return;
      clearTimeout(timer); timer = setTimeout(refresh, 400);
    });
    return () => {unsubscribe(); clearTimeout(timer);};
  }, [root,refresh]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase()==='j') {
        event.preventDefault();setPrivacy(hidden ? 'false' : 'true');
      }
    };
    window.addEventListener('keydown',handler);
    return () => window.removeEventListener('keydown',handler);
  }, [hidden,setPrivacy]);

  const mutate = async (operation: () => Promise<void>) => {
    setBusy(true);setError(null);
    try {await operation();refresh();} catch(reason) {setError(reason instanceof Error ? reason.message : 'Could not save the change.');}
    finally {setBusy(false);}
  };
  const toggleTask = (task:DailyTask): void => { void mutate(() => completeTask(window.markdownAPI,`${root}/RAM/todo.md`,task)); };
  const label = new Date(`${day}T12:00:00`).toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'});
  const parts = splitDailyLog(data?.document?.body ?? '');
  const activity = parts.activity.replace(/^##[^\n]*\n?/, '').split('\n').filter(line => /^\s*[-*]\s+/.test(line));
  const active = data?.candidates.filter(item=>item.status==='active') ?? [];
  const suggested = data?.candidates.filter(item=>item.status==='pending') ?? [];

  return <div className="today-page" aria-label="Today workspace">
    <div className="today-wrap">
      <header className="today-heading">
        <div><p className="today-eyebrow"><Sun size={14}/> A little space for your day</p><h1>{label}</h1><p className="today-subtitle">{day===localDate() ? 'What matters, what happened, and what you want to remember.' : 'Return to a day. Pick up a thought.'}</p></div>
        <div className="today-date-controls">
          <button aria-label="Previous day" onClick={()=>setDay(shiftDate(day,-1))}><ChevronLeft size={17}/></button>
          <label className="today-date"><CalendarDays size={15}/><input aria-label="Choose day" type="date" value={day} onChange={event=>{if(validDate(event.target.value))setDay(event.target.value);}}/></label>
          <button aria-label="Next day" onClick={()=>setDay(shiftDate(day,1))}><ChevronRight size={17}/></button>
          <button onClick={()=>setDay(localDate())}>Today</button>
        </div>
      </header>
      <div className="today-toolbar">
        {vaults.length>0 && <label>Vault <select aria-label="Daily vault" value={root} onChange={event=>selectRoot(event.target.value)}>{vaults.map(path=><option key={path} value={path}>{path.split('/').pop()}</option>)}</select></label>}
        <span className="today-toolbar-spacer"/>
        <button aria-label="Refresh day" onClick={refresh} disabled={loading}><RefreshCw size={14}/></button>
        <button aria-pressed={hidden} onClick={()=>setPrivacy(hidden?'false':'true')} title="Cmd/Ctrl+Shift+J">{hidden?<Eye size={15}/>:<EyeOff size={15}/>} {hidden?'Show journal & photos':'Hide journal & photos'}</button>
      </div>
      {error && <div className="today-error" role="alert">{error} <button onClick={refresh}>Refresh</button></div>}
      {discovering ? <p role="status" className="today-empty">Finding your vault…</p> : !root ? <section className="today-card today-welcome"><h2>Your day starts with a vault</h2><p>Open the vault that contains your daily logs in Inbox/Logs. Opal will bring your journal, briefing, and activity together here.</p><button onClick={()=>void useDiskStore.getState().openFolder()}>Open vault folder</button></section> : <>
        {loading && !data && <p role="status" className="today-empty">Opening your day…</p>}
        {data && <div className="today-columns" key={`${root}:${day}`}>
          <main className="today-main">
            <section className="today-card today-brief"><div className="today-section-heading"><h2>What matters</h2>{data.digestPath && <button onClick={()=>openSource(data.digestPath as string)}>Full briefing ↗</button>}</div>
              {data.brief ? <Markdown>{data.brief}</Markdown> : <p className="today-empty">No briefing for this day yet. Your routine’s next digest will appear here.</p>}
            </section>
            <section className="today-card"><div className="today-section-heading"><h2>Your journal</h2><span className="today-badge">{hidden?'Hidden':'Just for you'}</span></div>
              {data.document ? <JournalPanel path={data.document.path} journal={parts.journal} hidden={hidden} onOpen={()=>openSource(data.document?.path ?? '')}/> : <div className="today-empty"><p>A blank page for {label}.</p><button disabled={busy} onClick={()=>void mutate(()=>createDay(root,day))}>Start this day’s journal</button></div>}
            </section>
            <section className="today-card"><div className="today-section-heading"><h2>The day unfolding</h2><span className="today-badge">{activity.length} entries</span></div>
              {activity.length ? <ol className="today-timeline">{activity.map((line,index)=>{
                const event=line.replace(/^\s*[-*]\s+/,'');const match=event.match(/^(\d{1,2}:\d{2})\s*[—–-]\s*(.*)$/);
                return <li key={index}><time>{match?.[1]??'·'}</time><div><Markdown>{match?.[2]??event}</Markdown></div></li>;
              })}</ol> : <p className="today-empty">No activity recorded for this day. Entries from your routines will appear here.</p>}
            </section>
          </main>
          <aside className="today-aside" aria-label="Daily context">
            <section className="today-card"><div className="today-section-heading"><h2>On your list</h2><span className="today-badge">{data.tasks.length+active.length}</span></div><p className="today-caption">Current queue · carries across days</p>
              {data.tasks.length ? <ul className="today-tasks">{data.tasks.map(task=><li key={task.line}><input type="checkbox" aria-label={`Complete ${task.text}`} checked={false} disabled={busy} onChange={()=>toggleTask(task)}/><Markdown>{task.text}</Markdown></li>)}</ul> : <p className="today-empty">No unchecked tasks in your vault’s to-do file.</p>}
              {active.length>0 && <div className="today-active"><h3>Active from triage</h3>{active.map(item=><details key={item.id}><summary>{item.title}</summary><p>{item.context??'Tracked as active in your action queue.'}</p>{item.source&&<p className="today-source">{item.source}</p>}</details>)}</div>}
              <button className="today-source-button" onClick={()=>openSource(`${root}/RAM/todo.md`)}>Open to-do file ↗</button>
              {suggested.length>0 && <details className="today-suggestions"><summary>{suggested.length} suggestions to consider</summary><p className="today-caption">Collected by your routines. These are not accepted commitments.</p>{suggested.map(item=><details key={item.id}><summary>{item.title}</summary><p>{item.context??'No additional context saved.'}</p>{item.source&&<p className="today-source">{item.source}</p>}</details>)}<button onClick={()=>openSource(`${root}/RAM/triage/state.json`)}>Open triage source ↗</button></details>}
            </section>
            <section className="today-card"><div className="today-section-heading"><h2>Small moments</h2><span className="today-badge">Photos</span></div>
              {hidden ? <p className="today-empty">Photos are hidden with your journal.</p> : data.photos.length ? <div className="today-photos">{data.photos.map(path=><button key={path} aria-label={`Open photo ${path.split('/').pop()}`} onClick={()=>openSource(path)}><img src={toOpalFileUrl(path)} alt={path.split('/').pop()} loading="lazy"/></button>)}</div> : <p className="today-empty">Link a photo in your daily file, or place it in Photos/{day}/. It will appear here.</p>}
            </section>
            <p className="today-footer">Everything here comes from your vault. Your files stay yours.</p>
          </aside>
        </div>}
        {!!data?.warnings.length && <details className="today-warnings"><summary>Some sources are unavailable ({data.warnings.length})</summary>{data.warnings.map((warning,index)=><p key={index}>{warning}</p>)}</details>}
      </>}
    </div>
  </div>;
}
