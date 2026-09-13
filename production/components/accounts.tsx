import {createContext,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import {Clapperboard,Loader2,LockKeyhole,LogOut,KeyRound,Plus,Copy,UserRound,ShieldCheck,Users} from 'lucide-react';
import {Button} from './ui/button';
import {Input} from './ui/input';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription,DialogFooter} from './ui/dialog';
import {AlertDialog,AlertDialogContent,AlertDialogHeader,AlertDialogTitle,AlertDialogDescription,AlertDialogFooter,AlertDialogCancel,AlertDialogAction} from './ui/alert-dialog';
import {FormField,errorText,request} from './production-ui';
import {toast} from 'sonner';
import type {SessionUser} from '@/lib/production';
import {linkedAccount,studioEntry} from '@/lib/account-session';
import {accountHeaders,setRequestAccount} from '@/lib/client-account';
type Account={id:string;name:string;username:string;email:string;enabled:boolean;mustChangePassword:boolean};
const AccountContext=createContext<{user:SessionUser|null;refresh:()=>Promise<void>;signOut:()=>Promise<void>}>({user:null,refresh:async()=>{},signOut:async()=>{}});
export function useAccount(){return useContext(AccountContext);}
async function authRequest(path:string,body:unknown){const r=await fetch('/api/auth/'+path,{method:'POST',headers:{'Content-Type':'application/json',...(path==='change-password'?accountHeaders():{})},body:JSON.stringify(body)});const data=await r.json() as {error?:string;message?:string};if(!r.ok)throw new Error(r.status===429?'Too many attempts. Wait a minute and try again.':data.message||data.error||'Could not complete that request.');return data;}
export function AccountGate({children}:{children:ReactNode}){
 const entry=useRef(studioEntry(typeof window==='undefined'?'':window.location.search));
 const [user,setUser]=useState<SessionUser|null>(null),[loading,setLoading]=useState(true),[problem,setProblem]=useState(''),[busy,setBusy]=useState(false),[username,setUsername]=useState(entry.current?.username||''),[password,setPassword]=useState('');
 const activeUser=useRef<SessionUser|null>(null),requestId=useRef(0),channel=useRef<BroadcastChannel|null>(null);
 function setAccount(next:SessionUser|null){activeUser.current=next;setRequestAccount(next?.id||null);setUser(next);}
 function announce(){channel.current?.postMessage('account-changed');}
 function clearEntry(){entry.current=null;const url=new URL(window.location.href);if(url.searchParams.get('from')==='studio'){url.searchParams.delete('from');url.searchParams.delete('account');window.history.replaceState(window.history.state,'',url.pathname+url.search+url.hash);}}
 function closeAccount(message:string){++requestId.current;setAccount(null);setPassword('');setLoading(false);setProblem(message);}
 async function refresh(){
  const seq=++requestId.current;
  try{
   const r=await fetch('/api/session',{cache:'no-store'});
   const data=await r.json() as {user?:SessionUser;error?:string};
   if(seq!==requestId.current)return;
   if(r.status!==401&&!r.ok)throw new Error(data.error||'Could not open your account.');
   const current=r.status===401?null:data.user||null;
   const next=await linkedAccount(current,entry.current,async()=>{await authRequest('sign-out',{});announce();});
   if(seq!==requestId.current)return;
   if(activeUser.current&&next?.id!==activeUser.current.id){closeAccount('The production account changed. Sign in again to continue.');return;}
   setAccount(next);
   setProblem(current&&!next?'Sign in to your production account to continue.':'');
   if(next)clearEntry();
  }catch(e){if(seq===requestId.current){setAccount(null);setProblem(errorText(e));}}
  finally{if(seq===requestId.current)setLoading(false);}
 }
 async function signOut(){closeAccount('');try{await authRequest('sign-out',{});announce();}catch(e){setProblem(errorText(e));}}
 async function signIn(){
  const seq=++requestId.current,submittedUsername=username.trim().toLowerCase();setBusy(true);setProblem('');
  try{
   await authRequest('sign-in/username',{username:submittedUsername,password});
   if(seq!==requestId.current)return;
   setPassword('');entry.current={username:submittedUsername};announce();await refresh();
  }catch(e){if(seq===requestId.current)setProblem(errorText(e));}
  finally{setBusy(false);}
 }
 useEffect(()=>{
  if(typeof BroadcastChannel!=='undefined'){channel.current=new BroadcastChannel('smooth-production-account');channel.current.onmessage=()=>closeAccount('The production account changed in another tab. Sign in again to continue.');}
  void refresh();
  const onExpired=()=>closeAccount('Your session ended. Sign in again.');
  const checkAccount=()=>{if(activeUser.current&&document.visibilityState!=='hidden')void refresh();};
  window.addEventListener('account-expired',onExpired);window.addEventListener('focus',checkAccount);document.addEventListener('visibilitychange',checkAccount);
  const timer=window.setInterval(checkAccount,30000);
  return()=>{++requestId.current;channel.current?.close();channel.current=null;window.clearInterval(timer);window.removeEventListener('account-expired',onExpired);window.removeEventListener('focus',checkAccount);document.removeEventListener('visibilitychange',checkAccount);};
 },[]);
 const context={user,refresh,signOut};
 if(loading)return <div className="workspace-loading"><Loader2 className="spin"/>Opening your workspace…</div>;
 if(!user)return <AccountContext value={context}><div className="account-gate"><div className="login-brand"><span><Clapperboard/></span><div><strong>Production Dashboard</strong><small>SMOOTH STUDIOS</small></div></div><form className="login-card" onSubmit={e=>{e.preventDefault();void signIn();}}><span className="login-icon"><LockKeyhole/></span><h1>Sign in to productions</h1><p>Your projects. Your crew. Your next shoot.</p><FormField label="Username"><Input autoComplete="username" aria-label="Username" value={username} onChange={e=>setUsername(e.target.value)} required autoFocus/></FormField><FormField label="Password"><Input type="password" autoComplete="current-password" aria-label="Password" value={password} onChange={e=>setPassword(e.target.value)} required/></FormField>{problem&&<p className="login-error" role="alert">{problem}</p>}<Button type="submit" disabled={busy}>{busy?<Loader2 className="spin"/>:<LockKeyhole size={16}/>}Sign in</Button><small>Need an account or a password reset? Contact Smooth.</small></form><a className="login-rentals" href="https://smoothxstudios.github.io/smooth-studios-team-portal/">Studio Dashboard</a></div></AccountContext>;
 if(user.mustChangePassword)return <AccountContext value={context}><div className="account-gate"><div className="login-card"><h1>Make this account yours</h1><p>Set a password for your production account before continuing.</p><PasswordForm forced/><Button variant="ghost" onClick={signOut}>Sign out</Button></div></div></AccountContext>;
 return <AccountContext key={user.id} value={context}>{children}</AccountContext>;
}
function PasswordForm({forced=false,onDone}:{forced?:boolean;onDone?:()=>void}){
 const {refresh}=useAccount(),[current,setCurrent]=useState(''),[next,setNext]=useState(''),[confirm,setConfirm]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 return <form className="password-form" onSubmit={async e=>{e.preventDefault();if(next!==confirm){setError('The new passwords do not match.');return;}setBusy(true);setError('');try{await authRequest('change-password',{currentPassword:current,newPassword:next,revokeOtherSessions:true});await refresh();toast.success('Password changed');onDone?.();}catch(e){setError(errorText(e));}finally{setBusy(false);}}}><FormField label={forced?'Temporary password':'Current password'}><Input aria-label="Current password" type="password" autoComplete="current-password" value={current} onChange={e=>setCurrent(e.target.value)} required/></FormField><FormField label="New password" hint="At least 12 characters. A short phrase works well."><Input aria-label="New password" type="password" autoComplete="new-password" minLength={12} maxLength={128} value={next} onChange={e=>setNext(e.target.value)} required/></FormField><FormField label="Confirm new password"><Input aria-label="Confirm new password" type="password" autoComplete="new-password" value={confirm} onChange={e=>setConfirm(e.target.value)} required/></FormField>{error&&<p className="login-error" role="alert">{error}</p>}<Button type="submit" disabled={busy}>{busy?<Loader2 className="spin"/>:<KeyRound/>}Save new password</Button></form>;
}
export function AccountActions(){const {user,signOut}=useAccount(),[change,setChange]=useState(false);return <><div className="account-actions"><span>{user?.name}</span><Button size="icon" variant="ghost" aria-label="Change password" onClick={()=>setChange(true)}><KeyRound size={17}/></Button><Button size="icon" variant="ghost" aria-label="Sign out" onClick={signOut}><LogOut size={17}/></Button></div><Dialog open={change} onOpenChange={setChange}><DialogContent><DialogHeader><DialogTitle>Change password</DialogTitle><DialogDescription>This changes your production dashboard password and signs out other devices.</DialogDescription></DialogHeader><PasswordForm onDone={()=>setChange(false)}/></DialogContent></Dialog></>;
}
function temporaryPassword(){const bytes=crypto.getRandomValues(new Uint8Array(20));return Array.from(bytes,n=>'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'[n%55]).join('');}
export function TeamAccounts(){
 const {user}=useAccount(),[accounts,setAccounts]=useState<Account[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[draft,setDraft]=useState<{id?:string;name:string;username:string;email:string;password:string}|null>(null),[created,setCreated]=useState<{username:string;password:string}|null>(null),[busy,setBusy]=useState(false),[disable,setDisable]=useState<Account|null>(null);
 async function reload(){try{const d=await request<{accounts:Account[]}>('/api/team');setAccounts(d.accounts);setError('');}catch(e){setError(errorText(e));}finally{setLoading(false);}}
 useEffect(()=>{reload();},[]);
 return <div className="production-home"><div className="production-home-heading"><div><div className="eyebrow">SMOOTH STUDIOS / TEAM</div><h1>Team accounts</h1><p>Create individual logins, then assign people to productions.</p></div><Button onClick={()=>setDraft({name:'',username:'',email:'',password:temporaryPassword()})}><Plus/>New team account</Button></div>{error&&<p className="module-error" role="alert">{error}</p>}{loading?<p className="module-muted">Loading accounts…</p>:<div className="crew-grid">{accounts.map(a=><article className="production-section team-account-card" key={a.id}><span className="crew-avatar"><UserRound size={19}/></span><h2>{a.name}</h2><p>@{a.username}</p>{a.email&&<small>{a.email}</small>}<span className={"project-stage "+(a.enabled?'':'disabled')}>{a.id==='owner'?'Owner':a.enabled?'Active':'Disabled'}</span>{a.mustChangePassword&&<small>Password change required at next sign-in</small>}{a.id!==user?.id&&<div className="team-card-actions"><Button size="sm" variant="outline" onClick={()=>setDraft({id:a.id,name:a.name,username:a.username,email:a.email,password:temporaryPassword()})}><KeyRound size={15}/>Reset password</Button><Button size="sm" variant="ghost" onClick={()=>a.enabled?setDisable(a):request('/api/team','PUT',{id:a.id,enabled:true}).then(reload).catch(e=>toast.error(errorText(e)))}>{a.enabled?'Disable account':'Enable account'}</Button></div>}</article>)}</div>}<div className="access-note"><ShieldCheck size={17}/><p>Team members can create their own productions and tag others in <strong>Project overview</strong>. They can also view, edit, and export productions they are tagged in. Smooth retains access to every production. Disabling an account ends its sessions and blocks access across the production dashboard.</p></div>
 <Dialog open={!!draft||!!created} onOpenChange={v=>{if(!v&&!busy){setDraft(null);setCreated(null);}}}><DialogContent onInteractOutside={e=>e.preventDefault()}><DialogHeader><DialogTitle>{created?'Account details ready':draft?.id?'Reset password':'Create a team account'}</DialogTitle><DialogDescription>{created?'Share these details directly with the team member. They will choose a new password when they sign in.':draft?.id?'This signs out the account on other devices and requires a new password at the next sign-in.':'Choose a unique username and a temporary password. No email or invitation is sent automatically.'}</DialogDescription></DialogHeader>{created?<div className="credentials-card"><FormField label="Username"><Input readOnly value={created.username}/></FormField><FormField label="Temporary password"><Input readOnly value={created.password}/></FormField><Button variant="outline" onClick={()=>navigator.clipboard.writeText('Username: '+created.username+'\nTemporary password: '+created.password).then(()=>toast.success('Copied account details')).catch(()=>toast.error('Select and copy the details manually.'))}><Copy/>Copy details</Button></div>:draft&&<div className="form-grid">{!draft.id&&<><FormField label="Full name" wide><Input aria-label="Account full name" value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})}/></FormField><FormField label="Username" wide hint="3–30 letters, numbers, underscores, or periods."><Input aria-label="New account username" autoComplete="off" value={draft.username} onChange={e=>setDraft({...draft,username:e.target.value.toLowerCase()})}/></FormField><FormField label="Contact email (optional)" wide><Input type="email" aria-label="Account contact email" value={draft.email} onChange={e=>setDraft({...draft,email:e.target.value})}/></FormField></>}<FormField label="Temporary password" wide hint="At least 12 characters."><Input aria-label="Temporary account password" autoComplete="new-password" value={draft.password} onChange={e=>setDraft({...draft,password:e.target.value})}/></FormField></div>}<DialogFooter>{created?<Button onClick={()=>setCreated(null)}>Done</Button>:<><Button variant="outline" disabled={busy} onClick={()=>setDraft(null)}>Cancel</Button><Button disabled={busy} onClick={async()=>{if(!draft)return;setBusy(true);try{await request('/api/team',draft.id?'PUT':'POST',draft.id?{id:draft.id,password:draft.password}:draft);setCreated({username:draft.username,password:draft.password});setDraft(null);await reload();}catch(e){toast.error(errorText(e));}finally{setBusy(false);}}}>{busy&&<Loader2 className="spin"/>}{draft?.id?'Reset password':'Create account'}</Button></>}</DialogFooter></DialogContent></Dialog>
 <AlertDialog open={!!disable} onOpenChange={v=>!v&&setDisable(null)}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Disable {disable?.name}?</AlertDialogTitle><AlertDialogDescription>Their project assignments stay saved, but the account cannot sign in or open productions until you enable it again.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={async()=>{try{await request('/api/team','PUT',{id:disable?.id,enabled:false});await reload();}catch(e){toast.error(errorText(e));}}}>Disable account</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
 </div>;
}
