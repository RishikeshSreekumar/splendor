import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { MermaidDiagram } from '@/components/mermaid-diagram';
export default async function DesignPage() {
  const markdown = await readFile(resolve('docs/architecture.md'), 'utf8');
  const diagrams = [...markdown.matchAll(/## ([^\n]+)\n\n([\s\S]*?)```mermaid\n([\s\S]*?)```/g)];
  return (
    <>
      <div className="page-heading compact">
        <div>
          <div className="eyebrow">
            <span /> THE SYSTEM DESIGN
          </div>
          <h1>Clear rules. Clear boundaries.</h1>
          <p>UML documentation of the implemented TypeScript architecture.</p>
        </div>
        <span className="status-pill">{diagrams.length} architecture views</span>
      </div>
      <div className="design-intro panel">
        <span className="step-label">ONE APPLICATION</span>
        <h2>Next.js, from board to benchmark.</h2>
        <p>
          Pure game rules, an abstract player SDK, isolated bot execution, independent clocks, and
          persisted evaluation reports. Each boundary has one responsibility.
        </p>
      </div>
      {diagrams.map(([, title, description, source]) => (
        <section className="section-block" key={title}>
          <h2>{title}</h2>
          <p className="diagram-description">{description.trim()}</p>
          <MermaidDiagram source={source} />
        </section>
      ))}
      <section className="panel">
        <h2>The clock contract</h2>
        <p>
          60 seconds per bot, plus one second per completed turn. Main actions, returns, and noble
          choices consume the same remaining balance. Time spent by the rules engine, the UI, and
          the other player is excluded. Assisted turns earn no increment.
        </p>
        <p className="muted">
          The full design, API contracts, failure policies, and deployment boundaries are maintained
          in <code>docs/architecture.md</code>.
        </p>
      </section>
    </>
  );
}
