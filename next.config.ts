import type { NextConfig } from 'next';
const config: NextConfig = {
  outputFileTracingIncludes: {
    '/api/**/*': ['./.runtime/**/*', './bots/*.js'],
    // get_bot_guide serves the SDK declarations and README sections. A bare `./README.md`
    // glob matches by basename and would ship every package README in node_modules.
    '/api/mcp': ['./src/sdk.d.ts', './docs/../README.md'],
  },
  serverExternalPackages: ['quickjs-emscripten', 'esbuild', 'modal'],
};
export default config;
