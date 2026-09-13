import {useEffect,useRef,useState} from 'react';
import {Check,Download,FileText,Loader2} from 'lucide-react';
import {Button} from './ui/button';
import {Checkbox} from './ui/checkbox';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription,DialogFooter} from './ui/dialog';
import {Choice,request,errorText} from './production-ui';
import {PDF_SECTIONS,type PdfSection,type ExportProject} from '@/lib/export-model';
import {hasModule,type CrewMember,type ProjectFile} from '@/lib/production';
import type {Project,ProjectSummary} from '@/lib/shot-list';
type DownloadFile={url:string;name:string;pages:number};
const filename=(s:string)=>s.replace(/[^\p{L}\p{N}_ -]/gu,'').trim().replace(/\s+/g,'-').slice(0,100)||'Production';
export function ExportDialog({scope,project,projects,onClose}:{scope:'current'|'all';project:Project|null;projects:ProjectSummary[];onClose:()=>void}){
 const choices=scope==='current'&&project?projects.filter(p=>p.id===project.id):projects;
 const available=PDF_SECTIONS.filter(s=>scope==='all'||(project&&hasModule(project,s.key)));
 const [ids,setIds]=useState(choices.map(p=>p.id)),[sections,setSections]=useState<PdfSection[]>(available.map(s=>s.key)),[images,setImages]=useState(true),[mode,setMode]=useState('One combined PDF'),[busy,setBusy]=useState(false),[progress,setProgress]=useState(''),[error,setError]=useState(''),[warnings,setWarnings]=useState<string[]>([]),[downloads,setDownloads]=useState<DownloadFile[]>([]);
 const urls=useRef<string[]>([]);useEffect(()=>()=>urls.current.forEach(u=>URL.revokeObjectURL(u)),[]);
 async function generate(){
  setBusy(true);setError('');setWarnings([]);setProgress('Loading project details…');
  const next:DownloadFile[]=[];const notices=new Set<string>();
  try{
   const {createProjectPdf,browserReferenceImage}=await import('@/lib/project-pdf');
   const fonts=await Promise.all(['/fonts/ProductionSans.ttf','/fonts/ProductionSans-Bold.ttf'].map(async url=>{const r=await fetch(url);if(!r.ok)throw new Error('The PDF fonts could not be loaded. Please try again.');return new Uint8Array(await r.arrayBuffer());}));
   const entries:ExportProject[]=[];
   for(const id of ids){
    setProgress('Loading production '+(entries.length+1)+' of '+ids.length+'…');
    const p=project?.id===id&&!project.revision?project:(await request<{project:Project}>('/api/projects/'+id)).project;
    const needsCrew=sections.some(s=>['overview','crew','schedule'].includes(s)&&hasModule(p,s));
    const crew=needsCrew&&p.revision?(await request<{crew:CrewMember[]}>('/api/projects/'+id+'/crew')).crew:[];
    const files=sections.includes('files')&&hasModule(p,'files')&&p.revision?(await request<{files:ProjectFile[]}>('/api/projects/'+id+'/files')).files:[];
    entries.push({project:p,crew,files});
   }
   const jobs=mode==='Separate PDF per section'?entries.flatMap(e=>sections.filter(s=>hasModule(e.project,s)).map(s=>({entries:[e],sections:[s],name:e.project.title+'-'+PDF_SECTIONS.find(x=>x.key===s)!.label}))):mode==='Separate PDF per production'?entries.map(e=>({entries:[e],sections,name:e.project.title})).filter(job=>job.sections.some(s=>hasModule(job.entries[0].project,s))):[{entries,sections,name:entries.length===1?entries[0].project.title:'Smooth-Studios-Productions'}];
   if(!jobs.length)throw new Error('None of the selected sections are enabled. Choose another section.');
   for(const job of jobs){const result=await createProjectPdf(job.entries,{sections:job.sections,images,regularFont:fonts[0],boldFont:fonts[1],loadImage:browserReferenceImage,onProgress:setProgress});result.warnings.forEach(w=>notices.add(w));const url=URL.createObjectURL(new Blob([new Uint8Array(result.bytes)],{type:'application/pdf'}));urls.current.push(url);next.push({url,name:filename(job.name)+'.pdf',pages:result.pageCount});}
   setDownloads(next);setWarnings([...notices]);setProgress('');
  }catch(e){next.forEach(f=>URL.revokeObjectURL(f.url));setError(errorText(e));}finally{setBusy(false);}
 }
 return <Dialog open onOpenChange={v=>!v&&!busy&&onClose()}><DialogContent className="export-dialog" onInteractOutside={e=>busy&&e.preventDefault()} onEscapeKeyDown={e=>busy&&e.preventDefault()}><DialogHeader><DialogTitle>{downloads.length?'Your PDFs are ready':scope==='all'?'Export productions':'Export this production'}</DialogTitle><DialogDescription>{downloads.length?'Download the documents below.':scope==='all'?'Choose productions and combine them, or create a PDF for each.':'Export the full project or select individual sections.'}</DialogDescription></DialogHeader><div className="export-scroll">{downloads.length?<div className="export-downloads">{downloads.map((file,i)=><a className="export-download" key={i} href={file.url} download={file.name}><FileText size={22}/><span>{file.name}<small className="export-note"> · {file.pages} pages</small></span><Download size={20}/></a>)}{warnings.map(w=><p role="status" className="export-warning" key={w}>{w}</p>)}</div>:<>
 {scope==='all'&&<fieldset className="project-options"><legend>Productions</legend><label className="column-toggle"><Checkbox checked={ids.length===choices.length} onCheckedChange={v=>setIds(v?choices.map(p=>p.id):[])}/>Select all ({choices.length})</label><div className="export-projects">{choices.map(p=><label className="team-option" key={p.id}><Checkbox checked={ids.includes(p.id)} onCheckedChange={v=>setIds(v?[...ids,p.id]:ids.filter(id=>id!==p.id))}/><span><strong>{p.title}</strong><small>{p.shots} shots</small></span></label>)}</div></fieldset>}
 <fieldset className="project-options"><legend>Include sections</legend><p>Only enabled sections will appear in each production’s PDF.</p><div className="module-picker">{available.map(s=><label className="option-card" key={s.key}><Checkbox checked={sections.includes(s.key)} onCheckedChange={v=>setSections(v?[...sections,s.key]:sections.filter(k=>k!==s.key))}/><span><strong>{s.label}</strong></span></label>)}</div></fieldset><div className="export-options"><Choice label="PDF organization" value={mode} onChange={setMode} options={['One combined PDF',scope==='current'?'Separate PDF per section':'Separate PDF per production']}/><label><Checkbox checked={images} onCheckedChange={v=>setImages(!!v)} disabled={!sections.includes('shots')}/>Include shot reference images</label></div><p className="export-note">Scripts include the text saved in the project. Uploaded documents appear as a file list; their contents remain in the dashboard.</p>
 </>}{error&&<p className="module-error" role="alert">{error}</p>}{busy&&<p className="export-progress" role="status"><Loader2 className="spin" size={16}/>{progress}</p>}</div><DialogFooter><Button variant="outline" disabled={busy} onClick={onClose}>{downloads.length?'Done':'Cancel'}</Button>{!downloads.length&&<Button disabled={busy||!ids.length||!sections.length} onClick={generate}>{busy?<Loader2 className="spin"/>:<Download/>}{busy?'Creating PDFs…':'Create PDF'+(mode==='One combined PDF'?'':'s')}</Button>}</DialogFooter></DialogContent></Dialog>;
}
