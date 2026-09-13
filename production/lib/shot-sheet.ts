import {PDFDocument,PDFFont,PDFPage,rgb,type PDFImage,type RGB} from 'pdf-lib';
import {dateLabel} from './production';
import {timeLabel,type Project,type Shot} from './shot-list';
import type {PdfOptions} from './project-pdf';
import {categoryTitle} from './export-model';

type TextTools={clean:(value:string)=>string;wrap:(value:string,size:number,width:number,font?:PDFFont)=>string[]};
type TextRun={text:string;font:PDFFont};
type Item={kind:'text';text:string;runs?:TextRun[];height:number;size:number;font:PDFFont;color:RGB}|{kind:'image';image:PDFImage;width:number;height:number}|{kind:'divider';height:number};
const W=792,H=612,M=28,WIDTH=W-2*M,BOTTOM=52,PAD=6;
const ink=rgb(.12,.18,.26),muted=rgb(.36,.42,.50),blue=rgb(.21,.32,.48),line=rgb(.76,.80,.85);

export function orderedShots(project:Project,order:PdfOptions['shotOrder']='shooting'){
 const scene=(a:Shot,b:Shot)=>a.scene.localeCompare(b.scene,undefined,{numeric:true})||a.number.localeCompare(b.number,undefined,{numeric:true});
 return [...project.shots].sort((a,b)=>order==='scene'?scene(a,b):(a.order||Infinity)-(b.order||Infinity)||scene(a,b));
}

/** A continuous, landscape shooting sheet. Long rows continue with their shot ID and table headings repeated. */
export async function renderShotSheet(project:Project,options:PdfOptions,doc:PDFDocument,font:PDFFont,bold:PDFFont,text:TextTools,warnings:Set<string>){
 const widths=options.images?[32,60,191,185,60,88,120]:[32,60,239,205,60,140];
 const headers=options.images?['Order\nDone','Scene / Shot','Action / Production','Camera / Lighting / Sound','Timing','Reference','Notes']:['Order\nDone','Scene / Shot','Action / Production','Camera / Lighting / Sound','Timing','Notes'];
 const notesCol=widths.length-1,shots=orderedShots(project,options.shotOrder);
 let page:PDFPage,y=0,capacity=0;
 const lines=(value:string,col:number,size=8.2,strong=false,color=ink):Item[]=>text.wrap(value,size,widths[col]-PAD*2,strong?bold:font).map(s=>({kind:'text',text:s,height:size*1.3,size,font:strong?bold:font,color}));
 const fieldLines=(label:string,value:string,col:number):Item[]=>{
  const size=8.2,limit=widths[col]-2*PAD,result:Item[]=[];
  let runs:TextRun[]=[],used=0,space=false;
  const append=(s:string,f:PDFFont)=>{if(runs.at(-1)?.font===f)runs[runs.length-1].text+=s;else runs.push({text:s,font:f});used+=f.widthOfTextAtSize(s,size);};
  const flush=()=>{result.push({kind:'text',text:runs.map(r=>r.text).join(''),runs,height:size*1.3,size,font,color:ink});runs=[];used=0;space=false;};
  for(const [content,f] of [[categoryTitle(label)+':',bold],[value,font]] as const){
   for(const word of text.clean(content).split(/(\s+)/u).filter(Boolean)){
    if(/^\s+$/u.test(word)){const breaks=word.match(/\n/g)?.length||0;for(let n=0;n<breaks;n++)flush();space=breaks===0;continue;}
    let prefix=space&&runs.length?' ':'';
    if(used+f.widthOfTextAtSize(prefix+word,size)>limit&&runs.length){flush();prefix='';}
    if(f.widthOfTextAtSize(word,size)<=limit)append(prefix+word,f);
    else for(const char of word){if(used+f.widthOfTextAtSize(char,size)>limit&&runs.length)flush();append(char,f);}
    space=false;
   }
   space=true;
  }
  if(runs.length)flush();return result;
 };
 const newPage=()=>{
  page=doc.addPage([W,H]);
  page.drawText('SMOOTH STUDIOS / PRODUCTION',{x:M,y:H-25,size:7.5,font:bold,color:muted});
  const label='Shot List';page.drawText(label,{x:W-M-bold.widthOfTextAtSize(label,9),y:H-25,size:9,font:bold,color:blue});
  y=H-39;
  for(const title of text.wrap(project.title,16,WIDTH,bold)){page.drawText(title,{x:M,y:y-16,size:16,font:bold,color:ink});y-=20;}
  y-=5;
  const summary=[dateLabel(project.date),project.client||'Smooth Studios',shots.length+' Shots',options.shotOrder==='scene'?'Scene / Shot Order':'Shooting Order','Setup: '+shots.reduce((n,s)=>n+s.setup,0)+' min'].join('  /  ');
  for(const row of text.wrap(summary,8.2,WIDTH,font)){page.drawText(row,{x:M,y:y-8.2,size:8.2,font,color:muted});y-=11;}
  y-=10;
  page.drawRectangle({x:M,y:y-26,width:WIDTH,height:26,color:rgb(.92,.94,.96),borderColor:line,borderWidth:.5});
  let x=M;
  headers.forEach((header,col)=>{header.split('\n').forEach((s,i)=>page.drawText(s,{x:x+PAD,y:y-11-i*8,size:7.2,font:bold,color:blue}));x+=widths[col];});
  y-=26;capacity=y-BOTTOM;
 };
 newPage();
 if(!shots.length){page!.drawText('No shots added yet.',{x:M+PAD,y:y-24,size:10,font,color:muted});return;}
 for(const [index,shot] of shots.entries()){
  options.onProgress?.(project.title+' / Shot '+(index+1)+' of '+shots.length);
  const cells:Item[][]=widths.map(()=>[]);
  if(shot.description)cells[2].push(...lines(shot.description,2,8.8));
  for(const field of project.fields){
   if(field.key==='location')continue;
   const value=shot.values[field.key];if(!value?.trim())continue;
   const group=field.group.toLowerCase();
   const col=['notes','takes'].includes(field.key)||group==='notes'?notesCol:['talent','props','wardrobe'].includes(field.key)||group.includes('production')?2:3;
   const shortLabels:Record<string,string>={angle:'Angle',direction:'Direction',style:'Style',notes:'Director',takes:'Takes'};
   const label=field.custom?field.label:shortLabels[field.key]||field.label;
   if(col===3&&cells[col].length)cells[col].push({kind:'divider',height:5});
   cells[col].push(...fieldLines(label,value,col));
  }
  if(options.images){
   for(const ref of shot.references){
    try{
     if(!options.loadImage)throw new Error('Image loader unavailable');
     const source=await options.loadImage(ref.id);
     const image=source.mime==='image/jpeg'?await doc.embedJpg(source.bytes):await doc.embedPng(source.bytes);
     const scale=Math.min((widths[5]-2*PAD)/image.width,43/image.height);
     cells[5].push({kind:'image',image,width:image.width*scale,height:image.height*scale+4});
     cells[5].push(...lines(ref.caption||ref.name,5,7.1,false,muted));
    }catch{
     warnings.add('Some reference images could not be included. Their filenames are marked in the PDF.');
     cells[5].push(...lines('Reference unavailable: '+ref.name,5,7.1,false,muted));
     if(ref.caption)cells[5].push(...lines(ref.caption,5,7.1,false,muted));
    }
   }
  }
  let idLines=lines(shot.scene+' / '+shot.number,1,10,true);
  if(idLines.length>3){cells[2].unshift(...lines('Scene: '+shot.scene+'\nShot: '+shot.number,2));idLines=[...lines('See action',1,8,true)];}
  const identity=[...idLines,...lines(shot.priority,1,7.3,true),...lines(shot.status,1,7.3,false,muted)];
  const timing=[...lines('Setup',4,7,false,muted),...lines(shot.setup?shot.setup+' min':'-',4,8.2,true),...lines('Duration',4,7,false,muted),...lines(shot.duration?timeLabel(shot.duration):'-',4,8.2)];
  const minimum=Math.max(options.images?72:64,identity.reduce((n,item)=>n+item.height,0)+PAD*2,timing.reduce((n,item)=>n+item.height,0)+PAD*2);
  let continued=false;
  do{
   const fullHeight=Math.max(minimum,...cells.map(c=>c.reduce((n,item)=>n+item.height,0)+PAD*2));
   if(y-BOTTOM<minimum||(fullHeight>y-BOTTOM&&fullHeight<=capacity))newPage();
   const available=y-BOTTOM-PAD*2;
   const drawn=cells.map(c=>{if(continued&&c[0]?.kind==='divider')c.shift();let height=0,n=0;while(n<c.length&&height+c[n].height<=available){height+=c[n].height;n++;}if(n<c.length&&c[n-1]?.kind==='divider')n--;return c.splice(0,n);});
   const height=Math.max(minimum,...drawn.map(c=>c.reduce((n,item)=>n+item.height,0)+PAD*2));
   const more=cells.some(c=>c.length);
   drawn[1]=identity;drawn[4]=timing;
   if(continued)drawn[0]=lines('Cont.',0,6.6,false,muted);
   else drawn[0]=lines(String(shot.order||index+1),0,10,true);
   page!.drawRectangle({x:M,y:y-height,width:WIDTH,height,color:index%2?rgb(.975,.98,.987):rgb(1,1,1),borderColor:line,borderWidth:.5});
   let x=M;
   drawn.forEach((items,col)=>{
    if(col)page!.drawLine({start:{x,y},end:{x,y:y-height},thickness:.45,color:line});
    let top=y-PAD;
    for(const item of items){
     if(item.kind==='text'){let left=x+PAD;for(const run of item.runs||[{text:item.text,font:item.font}]){page!.drawText(run.text,{x:left,y:top-item.size,size:item.size,font:run.font,color:item.color});left+=run.font.widthOfTextAtSize(run.text,item.size);}}
     if(item.kind==='image')page!.drawImage(item.image,{x:x+(widths[col]-item.width)/2,y:top-item.height+4,width:item.width,height:item.height-4});
     if(item.kind==='divider')page!.drawLine({start:{x:x+PAD,y:top-item.height/2+1},end:{x:x+widths[col]-PAD,y:top-item.height/2+1},thickness:.35,color:line});
     top-=item.height;
    }
    if(col===0&&!continued){
     const bx=x+PAD,by=top-16;
     page!.drawRectangle({x:bx,y:by,width:10,height:10,borderColor:muted,borderWidth:.7});
     if(shot.status==='Complete'){page!.drawLine({start:{x:bx+2,y:by+5},end:{x:bx+4,y:by+2},thickness:1,color:ink});page!.drawLine({start:{x:bx+4,y:by+2},end:{x:bx+8,y:by+8},thickness:1,color:ink});}
    }
    x+=widths[col];
   });
   y-=height;
   if(more){continued=true;newPage();}
  }while(cells.some(c=>c.length));
 }
}
