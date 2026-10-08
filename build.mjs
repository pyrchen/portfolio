import { build } from 'esbuild';
import { copyFile, mkdir, cp } from 'node:fs/promises';
await mkdir('dist/v8',{recursive:true});
await cp('public','dist',{recursive:true});
await build({entryPoints:['src/portfolio-v8.js'],bundle:true,format:'esm',splitting:true,outdir:'dist/v8',chunkNames:'chunks/[name]-[hash]',minify:true,target:['es2022'],legalComments:'eof',metafile:true}).then(result=>console.log(`Built ${Object.keys(result.metafile.outputs).length} local browser bundles.`));
await Promise.all([copyFile('src/index.html','dist/index.html'),copyFile('src/index.html','dist/neon.html'),copyFile('src/portfolio-v8.css','dist/v8/portfolio-v8.css')]);
