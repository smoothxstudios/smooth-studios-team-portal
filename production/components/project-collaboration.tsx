import {createContext,useCallback,useContext,useEffect,useMemo,useState,type ReactNode} from 'react';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription,DialogFooter} from './ui/dialog';
import {Button} from './ui/button';
import type {MergeChoices,MergeConflict} from '@/lib/project-merge';
const DraftContext=createContext({count:0,adjust:(_delta:number)=>{}});
export function ProjectDraftProvider({children}:{children:ReactNode}){
 const [count,setCount]=useState(0),adjust=useCallback((delta:number)=>setCount(n=>Math.max(0,n+delta)),[]);
 const value=useMemo(()=>({count,adjust}),[count,adjust]);return <DraftContext value={value}>{children}</DraftContext>;
}
export function useProjectDraft(active=true){const {adjust}=useContext(DraftContext);useEffect(()=>{if(active){adjust(1);return()=>adjust(-1);}},[active,adjust]);}
export function useOpenDrafts(){return useContext(DraftContext).count;}
export type PendingReview={token:string;conflicts:MergeConflict[];resolve:(choices:MergeChoices|null)=>void};
function describe(value:unknown){if(value===undefined)return 'Removed';if(value==='')return 'Empty';if(typeof value==='string')return value;return JSON.stringify(value,null,2);}
export function ConflictReview({review,onDone}:{review:PendingReview;onDone:(choices:MergeChoices|null)=>void}){
 useProjectDraft();const [choices,setChoices]=useState<MergeChoices>({});
 return <Dialog open onOpenChange={v=>!v&&onDone(null)}><DialogContent className="merge-dialog" onInteractOutside={e=>e.preventDefault()}><DialogHeader><DialogTitle>Review Shared Changes</DialogTitle><DialogDescription>You and a teammate edited the same details. Choose a version for each item. Your other changes will be combined automatically.</DialogDescription></DialogHeader><div className="merge-scroll">{review.conflicts.map(c=><fieldset className="merge-field" key={c.key}><legend>{c.label}</legend><div className="merge-choices">{(['mine','current'] as const).map(choice=><label className={'merge-choice '+(choices[c.key]===choice?'selected':'')} key={choice}><span><input type="radio" name={c.key} checked={choices[c.key]===choice} onChange={()=>setChoices(previous=>({...previous,[c.key]:choice}))}/>{choice==='mine'?'Use My Version':'Use Team Version'}</span><pre>{describe(choice==='mine'?c.mine:c.current)}</pre></label>)}</div></fieldset>)}</div><DialogFooter><Button variant="outline" onClick={()=>onDone(null)}>Keep Editing</Button><Button disabled={review.conflicts.some(c=>!choices[c.key])} onClick={()=>onDone(choices)}>Save Selected Versions</Button></DialogFooter></DialogContent></Dialog>;
}
