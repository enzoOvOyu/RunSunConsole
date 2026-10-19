import { useQuery,useQueryClient } from '@tanstack/react-query';
import { useState,useEffect } from 'react';
import { api } from '../../lib/api-client';
import { toast } from '../../components/ui';
import { errorText,t } from '../../i18n';
export const pollInterval=Number(import.meta.env.VITE_POLL_INTERVAL_MS||3000);
export function useData<T>(key:readonly unknown[],path:string,options:{enabled?:boolean;poll?:boolean}={}){return useQuery<T>({queryKey:key,queryFn:()=>api<T>(path),enabled:options.enabled,refetchInterval:options.poll?pollInterval:false});}
export function useAction(){const client=useQueryClient();const [busy,setBusy]=useState(false);async function run<T>(action:()=>Promise<T>,success='success.saved'):Promise<T|undefined>{setBusy(true);try{const result=await action();await client.invalidateQueries();toast(t(success));return result;}catch(error){toast(errorText(error),true);return undefined;}finally{setBusy(false);}}return {run,busy};}
export function useDebounced(value:string,ms=200){const [state,setState]=useState(value);useEffect(()=>{const timer=setTimeout(()=>setState(value),ms);return ()=>clearTimeout(timer);},[value,ms]);return state;}
