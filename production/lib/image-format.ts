export const IMAGE_CHUNK_SIZE=128*1024;
export const MAX_IMAGE_SIZE=12*1024*1024;
export const IMAGE_TYPES=['image/jpeg','image/png','image/webp','image/gif'] as const;
export function imageMime(bytes:Uint8Array):string{
 if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';
 if([137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v))return 'image/png';
 const text=String.fromCharCode(...bytes.slice(0,12));
 if(text.startsWith('GIF87a')||text.startsWith('GIF89a'))return 'image/gif';
 if(text.startsWith('RIFF')&&text.slice(8,12)==='WEBP')return 'image/webp';
 return '';
}
