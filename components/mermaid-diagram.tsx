'use client';
import { useEffect, useId, useRef, useState } from 'react';
export function MermaidDiagram({ source }: { source: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, ''),
    container = useRef<HTMLDivElement>(null),
    [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    async function render() {
      try {
        const { default: mermaid } = await import('mermaid');
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: 'base',
          themeVariables: {
            primaryColor: '#f6eee6',
            primaryTextColor: '#302936',
            primaryBorderColor: '#bfa68f',
            lineColor: '#786b78',
            fontFamily: 'Arial, sans-serif',
          },
        });
        const { svg } = await mermaid.render(`uml${id}`, source);
        if (!cancelled && container.current) container.current.innerHTML = svg;
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Diagram could not render');
      }
    }
    void render();
    return () => {
      cancelled = true;
    };
  }, [id, source]);
  return (
    <div className="diagram-frame">
      {error ? <pre role="alert">{error}</pre> : <div ref={container} aria-label="UML diagram" />}
      <details>
        <summary>View Mermaid source</summary>
        <pre>{source}</pre>
      </details>
    </div>
  );
}
