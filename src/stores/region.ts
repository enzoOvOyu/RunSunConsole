import { create } from 'zustand';
import { REGIONS, type Region } from '../types/domain';
const initial=import.meta.env.VITE_DEFAULT_REGION as Region;
export const useRegion=create<{region:Region;setRegion:(region:Region)=>void}>(set=>({region:REGIONS.includes(initial)?initial:'jp',setRegion:region=>set({region})}));
