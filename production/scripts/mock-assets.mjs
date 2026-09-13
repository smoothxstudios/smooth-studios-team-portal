export function testAssets(request){
 const path=new URL(request.url).pathname;
 if(path==='/assets/current.js')return new Response('export const current = true;',{headers:{'Content-Type':'text/javascript','Cache-Control':'public, max-age=31536000, immutable'}});
 // Reproduce SPA fallback behavior when a previous deployment's asset is gone.
 return new Response('<!doctype html><title>Production</title>',{headers:{'Content-Type':'text/html; charset=utf-8'}});
}
