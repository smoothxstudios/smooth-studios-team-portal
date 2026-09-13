import type {SessionUser} from './production';

export type StudioEntry={username:string};

/** The Studio link selects a sign-in; it never authenticates a user or grants access. */
export function studioEntry(search:string):StudioEntry|null{
 const query=new URLSearchParams(search);
 if(query.get('from')!=='studio')return null;
 const username=(query.get('account')||'').trim().toLowerCase();
 return {username:/^[a-z0-9_.]{3,30}$/.test(username)?username:''};
}

export async function linkedAccount(user:SessionUser|null,entry:StudioEntry|null,signOut:()=>Promise<void>):Promise<SessionUser|null>{
 if(user&&entry&&(!entry.username||user.username?.toLowerCase()!==entry.username)){
  await signOut();
  return null;
 }
 return user;
}
