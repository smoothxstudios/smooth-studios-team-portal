import {PDFDocument,PDFFont,PDFPage,PDFHexString,PDFName,rgb,type PDFImage} from 'pdf-lib';
import {dateLabel} from './production';
import {timeLabel,type Project,type Reference,type Shot} from './shot-list';
import {orderedShots} from './shot-sheet';
import {categoryTitle} from './export-model';
import type {PdfOptions} from './project-pdf';

type TextTools={clean:(value:string)=>string;wrap:(value:string,size:number,width:number,font?:PDFFont)=>string[]};
const W=792,H=612,M=28,GAP=10,CARD=(W-2*M-3*GAP)/4,PAD=10,BOTTOM=49;
const ink=rgb(.12,.18,.27),muted=rgb(.39,.46,.56),blue=rgb(.25,.36,.54),border=rgb(.80,.85,.91),pale=rgb(.95,.96,.98);
const BODY=8.5,LEADING=11.6;

function shotNotes(project:Project,shot:Shot){
 return project.fields.filter(f=>['notes','takes'].includes(f.key)||f.group.toLowerCase()==='notes').filter(f=>shot.values[f.key]?.trim()).map(f=>f.key==='notes'?shot.values[f.key]:categoryTitle(f.key==='takes'?'Takes':f.label)+': '+shot.values[f.key]).join('\n\n');
}

/** Four image-led cards per landscape page, with real AcroForm Notes fields. */
export async function renderStoryboard(project:Project,options:PdfOptions,doc:PDFDocument,font:PDFFont,bold:PDFFont,text:TextTools,warnings:Set<string>){
 const form=doc.getForm(),shots=orderedShots(project,options.shotOrder),imageCache=new Map<string,Promise<PDFImage|null>>();
 let page:PDFPage,top=0,position=0;
 const fit=(value:string,size:number,width:number,strong=false)=>{const f=strong?bold:font;let s=text.clean(value).replace(/\s+/g,' ');if(f.widthOfTextAtSize(s,size)<=width)return s;while(s&&f.widthOfTextAtSize(s+'...',size)>width)s=s.slice(0,-1);return s+'...';};
 const newPage=()=>{
  page=doc.addPage([W,H]);
  page.drawText('SMOOTH STUDIOS / PRODUCTION',{x:M,y:H-25,size:7.5,font:bold,color:muted});
  page.drawText('Storyboard',{x:W-M-bold.widthOfTextAtSize('Storyboard',9),y:H-25,size:9,font:bold,color:blue});
  top=H-40;
  for(const row of text.wrap(project.title,16,W-2*M,bold)){page.drawText(row,{x:M,y:top-16,size:16,font:bold,color:ink});top-=20;}
  top-=5;
  const summary=[dateLabel(project.date),fit(project.client||'Smooth Studios',8.2,230),shots.length+' Shots',options.shotOrder==='scene'?'Scene / Shot Order':'Shooting Order'].join('  /  ');
  for(const row of text.wrap(summary,8.2,W-2*M,font)){page.drawText(row,{x:M,y:top-8.2,size:8.2,font,color:muted});top-=11;}
  top-=14;
 };
 const load=(ref:Reference)=>{
  if(!imageCache.has(ref.id))imageCache.set(ref.id,(async()=>{
   try{if(!options.loadImage)throw new Error('No image loader');const source=await options.loadImage(ref.id);return source.mime==='image/jpeg'?await doc.embedJpg(source.bytes):await doc.embedPng(source.bytes);}
   catch{warnings.add('Some storyboard reference images could not be included. Their filenames are marked on the cards.');return null;}
  })());
  return imageCache.get(ref.id)!;
 };
 const frame=(image:PDFImage|null,x:number,y:number,width:number,height:number,label:string)=>{
  page.drawRectangle({x,y,width,height,color:pale});
  if(image){const scale=Math.min(width/image.width,height/image.height),w=image.width*scale,h=image.height*scale;page.drawImage(image,{x:x+(width-w)/2,y:y+(height-h)/2,width:w,height:h});}
  else{const display=fit(label,7,width-12);page.drawText(display,{x:x+(width-font.widthOfTextAtSize(display,7))/2,y:y+height/2-3,size:7,font,color:muted});}
 };
 newPage();
 if(!shots.length){page!.drawText('No shots added yet.',{x:M,y:top-20,size:10,font,color:muted});return;}
 for(const [shotIndex,shot] of shots.entries()){
  options.onProgress?.(project.title+' / Storyboard '+(shotIndex+1)+' of '+shots.length);
  const refs=options.images?shot.references:[],pictures=await Promise.all(refs.map(load));
  const thumbRows=Math.ceil(Math.max(0,refs.length-1)/4),galleryHeight=thumbRows?thumbRows*28+5:0;
  const imageHeight=CARD*9/16,notesHeight=92,notesBottom=BOTTOM+30,notesTop=notesBottom+notesHeight;
  const badges=[shot.values.size,shot.values.movement].filter(Boolean).map(v=>fit(v,7.2,CARD-2*PAD-12));
  const badgeRows=badges.length===2&&badges.reduce((n,b)=>n+font.widthOfTextAtSize(b,7.2)+12,0)+5>CARD-2*PAD?2:badges.length?1:0;
  const descriptionTop=top-26-imageHeight-galleryHeight-12-badgeRows*19-(badges.length?5:0);
  const descriptionCapacity=Math.max(1,Math.floor((descriptionTop-notesTop-26)/LEADING));
  const noteCapacity=Math.floor((notesHeight-12)/(BODY*1.4));
  const descriptions=text.wrap(shot.description,BODY,CARD-2*PAD,font),notes=text.wrap(shotNotes(project,shot),BODY,CARD-2*PAD-6,font);
  const parts=Math.max(1,Math.ceil(descriptions.length/descriptionCapacity),Math.ceil(notes.length/noteCapacity));
  for(let part=0;part<parts;part++){
   if(position&&position%4===0)newPage();
   const x=M+(position%4)*(CARD+GAP),inner=x+PAD;position++;
   page!.drawRectangle({x,y:BOTTOM,width:CARD,height:top-BOTTOM,color:rgb(1,1,1),borderColor:border,borderWidth:.7});
   const id='Scene '+shot.scene.padStart(2,'0')+' / Shot '+shot.number.padStart(2,'0');
   page!.drawText(fit(id,7.6,CARD-2*PAD-(parts>1?34:0),true),{x:inner,y:top-16,size:7.6,font:bold,color:blue});
   if(parts>1)page!.drawText((part+1)+' / '+parts,{x:x+CARD-PAD-font.widthOfTextAtSize((part+1)+' / '+parts,7),y:top-16,size:7,font,color:muted});
   let y=top-26-imageHeight;
   frame(pictures[0]||null,x+.7,y,CARD-1.4,imageHeight,refs.length?'Unavailable: '+refs[0].name:options.images?'No Reference Image':'Images Not Included');
   if(refs.length>1){
    y-=5;const thumbWidth=(CARD-2*PAD-9)/4;
    for(let i=1;i<refs.length;i++){const row=Math.floor((i-1)/4),col=(i-1)%4;frame(pictures[i],inner+col*(thumbWidth+3),y-(row+1)*28,thumbWidth,24,'Unavailable: '+refs[i].name);}
    y-=thumbRows*28;
   }
   y-=12;let badgeX=inner;
   badges.forEach((badge,i)=>{const width=font.widthOfTextAtSize(badge,7.2)+12;if(i&&badgeRows===2){badgeX=inner;y-=19;}page!.drawRectangle({x:badgeX,y:y-14,width,height:16,color:pale});page!.drawText(badge,{x:badgeX+6,y:y-9,size:7.2,font,color:blue});badgeX+=width+5;});
   y-=badgeRows?24:0;
   const description=descriptions.slice(part*descriptionCapacity,(part+1)*descriptionCapacity);
   for(const row of description){page!.drawText(row,{x:inner,y:y-BODY,size:BODY,font,color:ink});y-=LEADING;}
   if(part<parts-1)page!.drawText('Continues on the next card',{x:inner,y:notesTop+19,size:6.8,font,color:muted});
   page!.drawText('Notes',{x:inner,y:notesTop+7,size:8,font:bold,color:blue});
   const field=form.createTextField('storyboard_notes_'+(form.getFields().length+1));
   field.enableMultiline();field.enableScrolling();field.disableSpellChecking();
   field.acroField.dict.set(PDFName.of('TU'),PDFHexString.fromText(project.title+' - '+id+' - Notes'+(parts>1?' - Part '+(part+1):'')));
   field.acroField.setDefaultAppearance('/'+font.name+' '+BODY+' Tf 0.12 0.18 0.27 rg');
   field.setText(notes.slice(part*noteCapacity,(part+1)*noteCapacity).join('\n'));
   field.addToPage(page!,{x:inner,y:notesBottom,width:CARD-2*PAD,height:notesHeight,font,textColor:ink,backgroundColor:rgb(.985,.99,1),borderColor:border,borderWidth:.6});
   field.setFontSize(BODY);field.updateAppearances(font);
   const status=fit(shot.status,7,(CARD-2*PAD)/2),priority=fit(shot.priority,7,(CARD-2*PAD)/2);
   page!.drawText(status,{x:inner,y:BOTTOM+16,size:7,font,color:muted});
   page!.drawText(priority,{x:x+CARD-PAD-font.widthOfTextAtSize(priority,7),y:BOTTOM+16,size:7,font,color:shot.priority==='Must have'?rgb(.64,.34,.21):muted});
   const timing=['#'+shot.order,shot.setup?shot.setup+' min Setup':'',shot.duration?timeLabel(shot.duration):''].filter(Boolean).join(' / ');
   page!.drawText(fit(timing,6.7,CARD-2*PAD),{x:inner,y:BOTTOM+5,size:6.7,font,color:muted});
  }
 }
}
