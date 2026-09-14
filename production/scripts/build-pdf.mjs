import {build} from 'esbuild';
import sharp from 'sharp';
// One stable, self-contained module keeps PDF code off the initial page download.
// Its URL survives deployments, so existing tabs never request a deleted hashed chunk.
await build({entryPoints:['lib/project-pdf.ts'],bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,outfile:'dist/client/assets/pdf-export.js'});
await Promise.all([[48,'favicon.png'],[180,'apple-touch-icon.png']].map(([size,name])=>sharp('public/smooth-studios-logo.png').resize(size,size,{fit:'contain'}).png().toFile('dist/client/'+name)));
