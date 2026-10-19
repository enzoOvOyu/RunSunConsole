import zh from './locales/zh-CN';
import en from './locales/en-US';
import { useLocale } from '../stores/locale';
export const dictionaries={ 'zh-CN':zh,'en-US':en };
export function t(key:string,values:Record<string,string|number>={}){const dict:Record<string,string>=useLocale.getState().locale==='en-US'?en:zh;const source:Record<string,string>=zh;let text=dict[key]||source[key]||key;for(const[k,v]of Object.entries(values))text=text.replaceAll(`{${k}}`,String(v));return text;}
export function dt(value:string){if(useLocale.getState().locale==='zh-CN')return value;const entries=Object.entries(zh).filter(([key])=>key.startsWith('data.')).sort((a,b)=>b[1].length-a[1].length);for(const[key,source]of entries){if(value.includes(source))return value.replace(source,t(key));}return value;}
export function useI18n(){useLocale(state=>state.locale);return {t,dt};}
export function errorText(error:unknown){const code=error instanceof Error?error.message:'INTERNAL';return t(`error.${code}`)===`error.${code}`?t('error.INTERNAL'):t(`error.${code}`);}
