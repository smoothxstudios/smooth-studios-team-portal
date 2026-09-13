import {PDFDocument,PDFFont,PDFPage,PDFHexString,PDFName,rgb,type PDFImage} from 'pdf-lib';
import {dateLabel} from './production';
import {timeLabel,type Project,type Reference,type Shot} from './shot-list';
import {orderedShots} from './shot-sheet';
import {categoryTitle} from './export-model';
import type {PdfOptions} from './project-pdf';

type TextTools={clean:(value:string)=>string;wrap:(value:string,size:number,width:number,font?:PDFFont)=>string[]};
type Card={shot:Shot;refs:Reference[];pictures:(PDFImage|null)[];imageHeight:number;thumbRows:number;badges:string[];badgeRows:number;description:string[];notes:string[];notesHeight:number;height:number;continues:boolean;part:number;parts:number};
const W=792,H=612,M=28,GAP=10,CARD=(W-2*M-3*GAP)/4,PAD=10,BOTTOM=49;
const ink=rgb(.12,.18,.27),muted=rgb(.39,.46,.56),blue=rgb(.25,.36,.54),border=rgb(.80,.85,.91),pale=rgb(.95,.96,.98);
const BODY=8.5,LEADING=11.6;

function shotNotes(project:Project,shot:Shot){
 return project.fields.filter(f=>['notes','takes'].includes(f.key)||f.group.toLowerCase()==='notes').filter(f=>shot.values[f.key]?.trim()).map(f=>f.key==='notes'?shot.values[f.key]:categoryTitle(f.key==='takes'?'Takes':f.label)+': '+shot.values[f.key]).join('\n\n');
}

/** Four columns of content-sized cards, with real editable AcroForm Notes fields. */
export async function renderStoryboard(project:Project,options:PdfOptions,doc:PDFDocument,font:PDFFont,bold:PDFFont,text:TextTools,warnings:Set<string>){
 const form=doc.getForm(),shots=orderedShots(project,options.shotOrder),imageCache=new Map<string,Promise<PDFImage|null>>();
 let page:PDFPage,top=0;
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
 const maxCardHeight=top-BOTTOM,cards:Card[]=[];
 for(const [shotIndex,shot] of shots.entries()){
  options.onProgress?.(project.title+' / Storyboard '+(shotIndex+1)+' of '+shots.length);
  const refs=options.images?shot.references:[],pictures=await Promise.all(refs.map(load));
  const thumbRows=Math.ceil(Math.max(0,refs.length-1)/4),galleryHeight=thumbRows?thumbRows*28+5:0;
  const imageHeight=refs.length?CARD*9/16:options.images?26:0;
  const badges=[shot.values.size,shot.values.movement].filter(Boolean).map(v=>fit(v,7.2,CARD-2*PAD-12));
  const badgeRows=badges.length===2&&badges.reduce((n,b)=>n+font.widthOfTextAtSize(b,7.2)+12,0)+5>CARD-2*PAD?2:badges.length?1:0;
  const beforeDescription=22+imageHeight+galleryHeight+(imageHeight?8:0)+(badgeRows?badgeRows*17+3:0);
  const descriptions=shot.description.trim()?text.wrap(shot.description,BODY,CARD-2*PAD,font):[];
  const noteText=shotNotes(project,shot),notes=noteText.trim()?text.wrap(noteText,BODY,CARD-2*PAD-6,font):[];
  const parts:Card[]=[];let descriptionOffset=0,noteOffset=0;
  do{
   const noteRows=notes.slice(noteOffset,noteOffset+6),notesHeight=Math.max(26,noteRows.length*BODY*1.4+12);
   const fixedHeight=beforeDescription+14+notesHeight+29;
   const roomWithoutContinuation=Math.floor((maxCardHeight-fixedHeight)/LEADING);
   const hasContinuation=noteOffset+noteRows.length<notes.length||descriptions.length-descriptionOffset>roomWithoutContinuation;
   const capacity=Math.max(1,Math.floor((maxCardHeight-fixedHeight-(hasContinuation?13:0))/LEADING));
   const description=descriptions.slice(descriptionOffset,descriptionOffset+capacity);
   descriptionOffset+=description.length;noteOffset+=noteRows.length;
   const continues=descriptionOffset<descriptions.length||noteOffset<notes.length;
   parts.push({shot,refs,pictures,imageHeight,thumbRows,badges,badgeRows,description,notes:noteRows,notesHeight,height:fixedHeight+description.length*LEADING+(continues?13:0),continues,part:parts.length+1,parts:0});
  }while(descriptionOffset<descriptions.length||noteOffset<notes.length);
  parts.forEach(card=>{card.parts=parts.length;cards.push(card);});
 }
 let rowTop=top;
 for(let start=0;start<cards.length;start+=4){
  const row=cards.slice(start,start+4),rowHeight=Math.max(...row.map(card=>card.height));
  if(rowTop-rowHeight<BOTTOM-.01){newPage();rowTop=top;}
  for(const [column,card] of row.entries()){
   const {shot,refs,pictures,imageHeight,thumbRows,badges,badgeRows,description,notes,notesHeight,continues,part,parts}=card;
   const x=M+column*(CARD+GAP),inner=x+PAD,bottom=rowTop-card.height;
   page!.drawRectangle({x,y:bottom,width:CARD,height:card.height,color:rgb(1,1,1),borderColor:border,borderWidth:.7});
   const id='Scene '+shot.scene.padStart(2,'0')+' / Shot '+shot.number.padStart(2,'0');
   page!.drawText(fit(id,7.6,CARD-2*PAD-(parts>1?34:0),true),{x:inner,y:rowTop-14,size:7.6,font:bold,color:blue});
   if(parts>1)page!.drawText(part+' / '+parts,{x:x+CARD-PAD-font.widthOfTextAtSize(part+' / '+parts,7),y:rowTop-14,size:7,font,color:muted});
   let y=rowTop-22;
   if(imageHeight){y-=imageHeight;frame(pictures[0]||null,x+.7,y,CARD-1.4,imageHeight,refs.length?'Unavailable: '+refs[0].name:'No Reference Image');}
   if(refs.length>1){
    y-=5;const thumbWidth=(CARD-2*PAD-9)/4;
    for(let i=1;i<refs.length;i++){const row=Math.floor((i-1)/4),col=(i-1)%4;frame(pictures[i],inner+col*(thumbWidth+3),y-(row+1)*28,thumbWidth,24,'Unavailable: '+refs[i].name);}
    y-=thumbRows*28;
   }
   if(imageHeight)y-=8;
   let badgeX=inner;
   badges.forEach((badge,i)=>{const width=font.widthOfTextAtSize(badge,7.2)+12;if(i&&badgeRows===2){badgeX=inner;y-=17;}page!.drawRectangle({x:badgeX,y:y-12,width,height:14,color:pale});page!.drawText(badge,{x:badgeX+6,y:y-8,size:7.2,font,color:blue});badgeX+=width+5;});
   if(badgeRows)y-=20;
   for(const line of description){page!.drawText(line,{x:inner,y:y-BODY,size:BODY,font,color:ink});y-=LEADING;}
   if(continues){page!.drawText('Continues on the next card',{x:inner,y:y-8,size:6.8,font,color:muted});y-=13;}
   const notesTop=y-14,notesBottom=notesTop-notesHeight;
   page!.drawText('Notes',{x:inner,y:notesTop+5,size:8,font:bold,color:blue});
   const field=form.createTextField('storyboard_notes_'+(form.getFields().length+1));
   field.enableMultiline();field.enableScrolling();field.disableSpellChecking();
   field.acroField.dict.set(PDFName.of('TU'),PDFHexString.fromText(project.title+' - '+id+' - Notes'+(parts>1?' - Part '+part:'')));
   field.acroField.setDefaultAppearance('/'+font.name+' '+BODY+' Tf 0.12 0.18 0.27 rg');
   field.setText(notes.join('\n'));
   field.addToPage(page!,{x:inner,y:notesBottom,width:CARD-2*PAD,height:notesHeight,font,textColor:ink,backgroundColor:rgb(.985,.99,1),borderColor:border,borderWidth:.6});
   field.setFontSize(BODY);field.updateAppearances(font);
   const status=fit(shot.status,7,(CARD-2*PAD)/2),priority=fit(shot.priority,7,(CARD-2*PAD)/2);
   page!.drawText(status,{x:inner,y:notesBottom-12,size:7,font,color:muted});
   page!.drawText(priority,{x:x+CARD-PAD-font.widthOfTextAtSize(priority,7),y:notesBottom-12,size:7,font,color:shot.priority==='Must have'?rgb(.64,.34,.21):muted});
   const timing=['#'+shot.order,shot.setup?shot.setup+' min Setup':'',shot.duration?timeLabel(shot.duration):''].filter(Boolean).join(' / ');
   page!.drawText(fit(timing,6.7,CARD-2*PAD),{x:inner,y:notesBottom-22,size:6.7,font,color:muted});
  }
  rowTop-=rowHeight+GAP;
 }
}
