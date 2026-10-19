import { create } from 'zustand';
export type Locale = 'zh-CN'|'en-US';
const saved = typeof localStorage === 'undefined' ? null : localStorage.getItem('rs.locale');
export const useLocale = create<{locale:Locale;setLocale:(locale:Locale)=>void}>((set)=>({locale:saved==='en-US'?'en-US':import.meta.env.VITE_I18N_DEFAULT_LOCALE==='en-US'?'en-US':'zh-CN',setLocale:locale=>{if(typeof localStorage!=='undefined')localStorage.setItem('rs.locale',locale);if(typeof document!=='undefined')document.documentElement.lang=locale;set({locale});}}));
