import type { NextConfig } from 'next';
const config: NextConfig = {
  outputFileTracingIncludes: { '/api/**/*': ['./.runtime/**/*', './bots/*.js'] },
  serverExternalPackages: ['quickjs-emscripten', 'esbuild', 'modal'],
};
export default config;
