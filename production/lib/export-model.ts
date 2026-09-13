import type {CrewMember,ProjectFile} from './production';
import type {Project} from './shot-list';
export const PDF_SECTIONS=[{key:'overview',label:'Project overview & team'},{key:'shots',label:'Shot list & reference images'},{key:'crew',label:'Crew & Tasks'},{key:'files',label:'Scripts & Files'},{key:'schedule',label:'Scheduling & Call Sheet'},{key:'budget',label:'Budget & Expenses'}] as const;
export type PdfSection=typeof PDF_SECTIONS[number]['key'];
export type ExportProject={project:Project;crew:CrewMember[];files:ProjectFile[]};
