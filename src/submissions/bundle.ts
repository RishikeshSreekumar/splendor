import { build } from 'esbuild';
import { posix } from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
export const projectSchema = z
  .array(z.object({ path: z.string().min(1).max(200), content: z.string().max(131072) }))
  .min(1)
  .max(64);
export type ProjectFile = z.infer<typeof projectSchema>[number];
export const MAX_PROJECT_BYTES = 1024 * 1024;
export function validateProject(input: unknown): ProjectFile[] {
  const files = projectSchema.parse(input),
    seen = new Set<string>();
  let bytes = 0;
  for (const file of files) {
    if (
      !/^[a-zA-Z0-9_-][a-zA-Z0-9_./-]*\.(ts|js|mjs|json)$/.test(file.path) ||
      file.path
        .split('/')
        .some((p) => p === '..' || p === '.' || p === 'node_modules' || p.startsWith('.')) ||
      file.path.includes('//')
    )
      throw new Error('Invalid project path: ' + file.path);
    if (seen.has(file.path)) throw new Error('Duplicate project path: ' + file.path);
    seen.add(file.path);
    const fileBytes = Buffer.byteLength(file.content);
    if (fileBytes > 131072) throw new Error('Each file must be at most 128 KiB');
    bytes += fileBytes;
  }
  if (bytes > MAX_PROJECT_BYTES) throw new Error('Project must be at most 1 MiB');
  if (!seen.has('index.ts')) throw new Error('The project needs an index.ts at its root');
  return [...files].sort((a, b) => a.path.localeCompare(b.path));
}
export async function bundleProject(input: unknown) {
  const files = validateProject(input),
    sources = new Map(files.map((f) => [f.path, f.content]));
  const result = await build({
    entryPoints: ['index.ts'],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'neutral',
    target: 'es2022',
    logLevel: 'silent',
    sourcemap: false,
    plugins: [
      {
        name: 'submission-files',
        setup(builder) {
          builder.onResolve({ filter: /.*/ }, (args) => {
            if (args.path === 'splendor') return { path: 'splendor', external: true };
            if (
              args.kind !== 'entry-point' &&
              !args.path.startsWith('./') &&
              !args.path.startsWith('../')
            )
              throw new Error('Only relative imports and the splendor SDK are allowed');
            const base =
              args.kind === 'entry-point'
                ? args.path
                : posix.join(posix.dirname(args.importer), args.path);
            if (base.startsWith('../') || base.startsWith('/'))
              throw new Error('Import leaves the project');
            const path = [
              base,
              base + '.ts',
              base + '.js',
              base + '.json',
              base + '/index.ts',
              base + '/index.js',
            ].find((p) => sources.has(p));
            if (!path) throw new Error('Cannot resolve project import: ' + args.path);
            return { path, namespace: 'submission' };
          });
          builder.onLoad({ filter: /.*/, namespace: 'submission' }, (args) => ({
            contents: sources.get(args.path)!,
            loader: args.path.endsWith('.json') ? 'json' : args.path.endsWith('.ts') ? 'ts' : 'js',
          }));
        },
      },
    ],
  });
  const projectHash = createHash('sha256').update(JSON.stringify(files)).digest('hex');
  const source = result.outputFiles[0].text + '\n// project ' + projectHash + '\n';
  if (Buffer.byteLength(source) > 131072) throw new Error('Compiled bot must be at most 128 KiB');
  return { source, files, projectHash };
}
