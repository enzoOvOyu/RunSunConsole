import { create } from 'zustand';
import type { Role } from '../types/domain';
export const useAuth = create<{role:Role;project:string;setRole:(role:Role)=>void;setProject:(project:string)=>void}>(set=>({role:'owner',project:'',setRole:role=>set({role}),setProject:project=>set({project})}));
