import { it } from 'vitest';
it('debug', async () => {
  const mermaid = (await import('mermaid')).default;
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });
  const t = performance.now();
  console.log(await mermaid.parse('flowchart TD\n  A[Write] --> B{Review}\n  style A fill:#f9f,stroke:#333'));
  console.log(await mermaid.parse('flowchart TD\n  A[ --> ', { suppressErrors: true }));
  try { await mermaid.parse('flowchart TD\n  A[ --> '); } catch (e) { console.log('err', String(e).slice(0, 200)); }
  console.log('ms', performance.now() - t);
});
