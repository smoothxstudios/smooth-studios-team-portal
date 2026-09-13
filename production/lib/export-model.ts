import type {CrewMember,ProjectFile} from './production';
import type {Project} from './shot-list';
export const PDF_SECTIONS=[{key:'overview',label:'Project Overview & Team'},{key:'shots',label:'Shot List & Reference Images'},{key:'crew',label:'Crew & Tasks'},{key:'files',label:'Scripts & Files'},{key:'schedule',label:'Scheduling & Call Sheet'},{key:'budget',label:'Budget & Expenses'}] as const;
export type PdfSection=typeof PDF_SECTIONS[number]['key'];
export type ExportProject={project:Project;crew:CrewMember[];files:ProjectFile[]};
export const exportFilename=(name:string)=>name.normalize('NFC').replace(/['’]/g,'').replace(/[^\p{L}\p{N}\p{M}]+/gu,'-').replace(/^-+|-+$/g,'').slice(0,100).replace(/-+$/,'')||'Production';
export const categoryTitle=(label:string)=>label.trim().replace(/\s+/g,' ').replace(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu,word=>word[0].toLocaleUpperCase()+word.slice(1));
