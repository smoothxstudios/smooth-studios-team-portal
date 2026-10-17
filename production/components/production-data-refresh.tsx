import {createContext,useContext,useEffect,useLayoutEffect,useMemo,useRef,type ReactNode} from 'react';
import {createProductionRefresh} from '@/lib/production-refresh.mjs';
const Context=createContext<ReturnType<typeof createProductionRefresh>|null>(null);
export function ProductionDataRefreshProvider({children}:{children:ReactNode}){
 const coordinator=useMemo(()=>createProductionRefresh(),[]);
 return <Context value={coordinator}>{children}</Context>;
}
export function useProductionRead(read:()=>Promise<unknown>,enabled=true,key=''){
 const coordinator=useContext(Context),latest=useRef(read);
 useLayoutEffect(()=>{latest.current=read;},[read]);
 useEffect(()=>{if(enabled&&coordinator)return coordinator.register(()=>latest.current());},[coordinator,enabled,key]);
}
export function useProductionRefresh(){
 const coordinator=useContext(Context);
 return async()=>{if(!coordinator)return false;try{await coordinator.run();return true;}catch{return false;}};
}
