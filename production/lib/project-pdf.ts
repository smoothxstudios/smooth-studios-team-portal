import {PDFDocument,PDFFont,PDFPage,PDFName,PDFString,rgb,type RGB} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {hasModule,productionOf,dateLabel,clockLabel,money,expenseTotals,type CrewMember,type ProjectFile} from './production';
import {timeLabel,type Project} from './shot-list';
import {orderedShots,renderShotSheet} from './shot-sheet';
import {renderStoryboard} from './storyboard-pdf';
import {accountHeaders} from './client-account';

import {PDF_SECTIONS,categoryTitle,type PdfSection,type ExportProject} from './export-model';
export type PdfOptions={sections:PdfSection[];images:boolean;shotLayout?:'sheet'|'detail'|'storyboard';shotOrder?:'shooting'|'scene';regularFont:Uint8Array;boldFont:Uint8Array;loadImage?:(id:string)=>Promise<{bytes:Uint8Array;mime:string}>;onProgress?:(text:string)=>void};
const ink=rgb(.12,.18,.28),muted=rgb(.40,.47,.57),blue=rgb(.25,.39,.64),line=rgb(.85,.89,.94);
const W=612,H=792,M=48,BOTTOM=54,WIDTH=W-2*M;

class Pages {
 page!:PDFPage;y=H-80;projectTitle='';sectionTitle='';itemTitle='';
 chars:Set<number>;
 constructor(public doc:PDFDocument,public font:PDFFont,public bold:PDFFont,public warnings:Set<string>){this.chars=new Set(font.getCharacterSet());}
 clean(value:string){return Array.from(String(value).normalize('NFC').replace(/[\u0000-\u0008\u000B-\u001F]/g,'').replace(/\t/g,'    ')).map(c=>{if(c==='\n'||this.chars.has(c.codePointAt(0)!))return c;this.warnings.add('Some characters are not supported by the PDF font and appear as ?.');return '?';}).join('');}
 wrap(value:string,size:number,width=WIDTH,font=this.font){
  const lines:string[]=[];
  for(const paragraph of this.clean(value).split('\n')){
   if(!paragraph.trim()){lines.push('');continue;}let current='';
   for(const word of paragraph.trim().split(/\s+/)){
    if(font.widthOfTextAtSize((current?current+' ':'')+word,size)<=width){current+=(current?' ':'')+word;continue;}
    if(current){lines.push(current);current='';}
    for(const char of word){if(font.widthOfTextAtSize(current+char,size)>width&&current){lines.push(current);current='';}current+=char;}
   }if(current)lines.push(current);
  }return lines;
 }
 newPage(){this.page=this.doc.addPage([W,H]);this.y=H-82;this.page.drawRectangle({x:M,y:H-42,width:30,height:3,color:blue});this.page.drawText('SMOOTH STUDIOS / PRODUCTION DASHBOARD',{x:M+41,y:H-42,size:8,font:this.bold,color:muted});const sectionWidth=this.font.widthOfTextAtSize(this.sectionTitle,8);if(this.projectTitle)this.page.drawText(this.ellipsis(this.projectTitle,8,WIDTH-sectionWidth-22),{x:M,y:H-61,size:8,font:this.font,color:muted});if(this.sectionTitle)this.page.drawText(this.sectionTitle,{x:W-M-sectionWidth,y:H-61,size:8,font:this.font,color:muted});}
 ellipsis(value:string,size:number,width:number){let s=this.clean(value).replaceAll('\n',' ');if(this.font.widthOfTextAtSize(s,size)<=width)return s;while(s&&this.font.widthOfTextAtSize(s+'...',size)>width)s=s.slice(0,-1);return s+'...';}
 need(height:number){if(!this.page||this.y-height<BOTTOM){this.newPage();if(this.itemTitle){this.page.drawText(this.ellipsis(this.itemTitle+' (continued)',10,WIDTH),{x:M,y:this.y-12,size:10,font:this.bold,color:blue});this.y-=32;}}}
 gap(n=12){this.y-=n;}
 text(value:string,size=10,color:RGB=ink,bold=false){const font=bold?this.bold:this.font,leading=size*1.5;for(const text of this.wrap(value,size,WIDTH,font)){this.need(leading);this.page.drawText(text,{x:M,y:this.y-size,size,font,color});this.y-=leading;}}
 title(value:string){this.text(value,23,ink,true);this.gap(12);}
 heading(value:string){this.need(65);this.gap(8);this.text(value,13,blue,true);this.gap(6);}
 rule(){this.need(15);this.page.drawLine({start:{x:M,y:this.y-3},end:{x:W-M,y:this.y-3},thickness:.7,color:line});this.gap(17);}
 facts(items:[string,string|number][]) {
  const width=(WIDTH-22)/2;
  for(let i=0;i<items.length;i+=2){const row=items.slice(i,i+2);const lines=row.map(([,v])=>this.wrap(String(v||'Not set'),10,width));
   if(lines.some(l=>l.length>18)){for(const [label,value]of row){this.heading(categoryTitle(label));this.text(String(value||'Not set'));}continue;}
   const labels=row.map(([label])=>this.wrap(categoryTitle(label),8,width,this.bold));const labelHeight=Math.max(...labels.map(l=>l.length))*12;
   const height=labelHeight+11+Math.max(...lines.map(l=>l.length))*15;this.need(height+8);
   row.forEach((_,col)=>{const x=M+col*(width+22);labels[col].forEach((label,j)=>this.page.drawText(label,{x,y:this.y-9-j*12,size:8,font:this.bold,color:muted}));lines[col].forEach((s,j)=>this.page.drawText(s,{x,y:this.y-labelHeight-16-j*15,size:10,font:this.font,color:ink}));});this.y-=height+10;
  }
 }
 finish(){const pages=this.doc.getPages();pages.forEach((p,i)=>{const w=p.getWidth(),m=w>W?28:M;p.drawLine({start:{x:m,y:34},end:{x:w-m,y:34},thickness:.6,color:line});p.drawText('SMOOTH STUDIOS',{x:m,y:21,size:8,font:this.bold,color:muted});const num=(i+1)+' / '+pages.length;p.drawText(num,{x:w-m-this.font.widthOfTextAtSize(num,8),y:21,size:8,font:this.font,color:muted});});}
}

export async function createProjectPdf(entries:ExportProject[],options:PdfOptions){
 if(!entries.length||!options.sections.length)throw new Error('Choose a production and at least one section.');
 const doc=await PDFDocument.create();doc.registerFontkit(fontkit);
 // Fillable notes need the full font, including characters entered after export.
 const font=await doc.embedFont(options.regularFont,{subset:options.shotLayout!=='storyboard'}),bold=await doc.embedFont(options.boldFont,{subset:true});
 const warnings=new Set<string>(),p=new Pages(doc,font,bold,warnings);
 doc.setTitle(entries.length===1?entries[0].project.title+' - Production':'Smooth Studios - Productions');doc.setAuthor('Smooth Studios');doc.setCreator('Production Dashboard');
 if(entries.length>1&&options.sections.some(s=>s!=='shots')){p.newPage();p.title('Production collection');p.text(entries.length+' productions',12,muted);p.gap(20);for(const {project}of entries){p.heading(project.title);p.text([project.client,dateLabel(project.date),productionOf(project).stage].filter(Boolean).join(' / '));}}
 for(const entry of entries){
  const {project,crew,files}=entry,pd=productionOf(project);
  const sections=PDF_SECTIONS.filter(s=>options.sections.includes(s.key)&&hasModule(project,s.key));
  if(!sections.length){warnings.add(project.title+': none of the selected sections are enabled.');continue;}
  for(const section of sections){
   if(section.key==='shots'&&options.shotLayout==='storyboard'){await renderStoryboard(project,options,doc,font,bold,p,warnings);continue;}
   if(section.key==='shots'&&options.shotLayout!=='detail'){await renderShotSheet(project,options,doc,font,bold,p,warnings);continue;}
   p.projectTitle=project.title;p.sectionTitle=section.key==='shots'?'Shot Breakdown':section.label;p.newPage();p.title(project.title);p.text(p.sectionTitle,13,blue,true);p.gap(18);options.onProgress?.(project.title+' / '+p.sectionTitle);
   if(section.key==='overview'){
    p.facts([['Client',project.client||'Smooth Studios'],['Shoot date',dateLabel(project.date)],['Stage',pd.stage],['Deadline',pd.due?dateLabel(pd.due):'Not set'],['Shots',project.shots.length],['Team members',crew.length]]);
    if(project.brief){p.heading('Project Notes');p.text(project.brief);}
    p.heading('Project Team');if(!crew.length)p.text('No team members tagged.');for(const m of crew){p.text(m.name+' / '+m.role,11,ink,true);if(m.phone)p.text(m.phone,9,muted);p.gap(8);}
    p.heading('Included Project Sections');p.text(PDF_SECTIONS.filter(s=>hasModule(project,s.key)).map(s=>s.label).join('\n'));
   }
   if(section.key==='shots'){
    const shots=orderedShots(project,options.shotOrder);
    if(!shots.length)p.text('No shots added yet.');
    for(const shot of shots){const facts:[string,string|number][]=[['Shooting order',shot.order],['Setup',shot.setup+' min'],['Duration',timeLabel(shot.duration)],...project.fields.filter(f=>shot.values[f.key]).map(f=>[f.label,shot.values[f.key]] as [string,string])];
     const estimate=90+p.wrap(shot.description,11).length*17+Math.ceil(facts.length/2)*55+(options.images?shot.references.length*255:0);
     p.need(shot===shots[0]?130:Math.min(H-82-BOTTOM,estimate));p.heading('Scene '+shot.scene+' / Shot '+shot.number);p.itemTitle='Scene '+shot.scene+' / Shot '+shot.number;p.text(shot.status+' / '+shot.priority,9,muted);p.gap(9);if(shot.description)p.text(shot.description,11);p.gap(9);
     p.facts(facts);
     if(options.images){for(const ref of shot.references){try{
      if(!options.loadImage)throw new Error('Image loader unavailable');const image=await options.loadImage(ref.id);const embedded=image.mime==='image/jpeg'?await doc.embedJpg(image.bytes):await doc.embedPng(image.bytes);
      const scale=Math.min(WIDTH/embedded.width,220/embedded.height),width=embedded.width*scale,height=embedded.height*scale;p.need(height+42);p.page.drawImage(embedded,{x:M+(WIDTH-width)/2,y:p.y-height,width,height});p.y-=height+8;p.text(ref.caption||ref.name,9,muted);p.gap(10);
     }catch{warnings.add('Some reference images could not be included. Their filenames are marked in the PDF.');p.text('Reference unavailable: '+ref.name,9,muted);if(ref.caption)p.text(ref.caption,9,muted);}}}
     p.itemTitle='';if(p.y>BOTTOM+25)p.rule();
    }
   }
   if(section.key==='crew'){
    p.heading('Crew Assignments');if(!crew.length)p.text('No team members assigned.');for(const m of crew){p.need(85);p.text(m.name,12,ink,true);p.facts([['Role',m.role],['Call',clockLabel(m.callTime||pd.callSheet.call)],['Phone',m.phone||'Not set']]);p.rule();}
    p.heading('Task Checklist');if(!pd.tasks.length)p.text('No tasks added.');for(const t of pd.tasks){p.need(100);p.heading(t.title);p.facts([['Status',t.status],['Department',t.department],['Assigned to',crew.find(m=>m.id===t.assignee)?.name||'Unassigned'],['Due',t.due?dateLabel(t.due):'Not set']]);if(t.notes)p.text(t.notes);p.rule();}
   }
   if(section.key==='files'){
    if(!pd.documents.length)p.text('No written documents added.');for(const d of pd.documents){p.heading(d.title);p.text(d.kind,9,muted);p.gap(9);if(d.content)p.text(d.content);if(d.url){p.gap(9);p.text('Working link: '+d.url,9,blue);}p.rule();}
    p.heading('Uploaded Files');p.text('Uploaded file contents are stored separately in the dashboard.',9,muted);p.gap(10);if(!files.length)p.text('No uploaded files.');for(const f of files){p.text(f.name,10,ink,true);p.text(f.category+' / '+(f.size/1048576).toFixed(2)+' MB',9,muted);p.gap(10);}
   }
   if(section.key==='schedule'){
    const c=pd.callSheet;p.heading('Call Sheet');p.facts([['Shoot date',dateLabel(c.date||project.date)],['Time zone',pd.timezone.replaceAll('_',' ')],['General call',clockLabel(c.call)],['Estimated wrap',clockLabel(c.wrap)],['Location',c.location],['Address',c.address],['Contact',c.contactName],['Phone',c.contactPhone]]);
    for(const [label,value]of [['Parking & Arrival',c.parking],['Safety & Emergency Information',c.safety],['Production Notes',c.notes]])if(value){p.heading(label);p.text(value);}
    if(crew.length){p.heading('Crew Calls');for(const m of crew)p.text(m.name+' / '+m.role+' / '+clockLabel(m.callTime||c.call));}
    p.heading('Shoot Schedule');if(!pd.schedule.length)p.text('No schedule blocks added.');for(const b of [...pd.schedule].sort((a,b)=>(a.date+a.start).localeCompare(b.date+b.start))){p.need(95);p.heading(b.title);p.text(dateLabel(b.date)+' / '+clockLabel(b.start)+' - '+clockLabel(b.end),10,blue);p.text(b.type+(b.location?' / '+b.location:''),9,muted);if(b.shotIds.length)p.text('Shots: '+b.shotIds.map(id=>{const s=project.shots.find(s=>s.id===id);return s?s.scene+'.'+s.number:'Removed shot';}).join(', '),9);if(b.notes){p.gap(7);p.text(b.notes);}p.rule();}
   }
   if(section.key==='budget'){
    const total=expenseTotals(pd.expenses);p.facts([['Approved budget',money(pd.budgetCents)],['Planned costs',money(total.planned)],['Actual spend',money(total.actual)],['Paid',money(total.paid)],['Unpaid',money(total.actual-total.paid)],['Remaining',money(pd.budgetCents-total.actual)]]);p.heading('Expense Breakdown');if(!pd.expenses.length)p.text('No expenses added.');for(const e of pd.expenses){p.need(110);p.heading(e.title);p.facts([['Category',e.category],['Vendor',e.vendor||'Not set'],['Planned',money(e.plannedCents)],['Actual',money(e.actualCents)],['Payment',e.paid?'Paid':'Unpaid'],['Date',e.date?dateLabel(e.date):'Not set']]);if(e.notes)p.text(e.notes);p.rule();}
   }
  }
 }
 if(!doc.getPageCount())throw new Error('None of the selected sections are enabled for these productions.');
 if(options.shotLayout==='storyboard'){
  const form=doc.getForm();
  // Expose the font to PDF readers when they regenerate edited field appearances.
  form.acroForm.dict.set(PDFName.of('DR'),doc.context.obj({Font:{[font.name]:font.ref}}));
  form.acroForm.dict.set(PDFName.of('DA'),PDFString.of('/'+font.name+' 8.5 Tf 0.12 0.18 0.27 rg'));
  form.updateFieldAppearances(font);
 }
 p.finish();return {bytes:await doc.save({updateFieldAppearances:false}),warnings:[...warnings],pageCount:doc.getPageCount()};
}

export async function browserReferenceImage(id:string){
 const response=await fetch('/api/images/'+id,{cache:'no-store',headers:accountHeaders()});if(!response.ok)throw new Error('Reference unavailable');
 const blob=await response.blob();const url=URL.createObjectURL(blob);
 try{const img=new Image();await new Promise<void>((resolve,reject)=>{img.onload=()=>resolve();img.onerror=()=>reject(new Error('Reference image could not be decoded'));img.src=url;});
  const scale=Math.min(1,1400/Math.max(img.naturalWidth,img.naturalHeight));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Image export unavailable');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);
  const output=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Image export unavailable')),'image/jpeg',.88));return {bytes:new Uint8Array(await output.arrayBuffer()),mime:'image/jpeg'};
 }finally{URL.revokeObjectURL(url);}
}
