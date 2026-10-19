import {create} from 'zustand';
import type {Resource} from '../types/domain';
export const useResourceTransition=create<{items:Resource[];mark:(r:Resource)=>void}>((set,get)=>({items:[],mark:r=>{set({items:[...get().items.filter(x=>x.resourceUuid!==r.resourceUuid),{...r,deletedAt:null,status:'terminating'} as Resource]});setTimeout(()=>set({items:get().items.filter(x=>x.resourceUuid!==r.resourceUuid)}),1800);}}));
