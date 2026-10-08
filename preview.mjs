// Development-only static preview. Production publishes dist/ without Node.js.
import { context } from 'esbuild';
const preview = await context({ entryPoints: [], write: false });
await preview.serve({ servedir: 'dist', host: '127.0.0.1', port: Number(process.env.PORT || 4173) });
console.log('Static preview: http://127.0.0.1:' + (process.env.PORT || 4173));
