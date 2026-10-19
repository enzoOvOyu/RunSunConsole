import {it,expect} from 'vitest';
import {dictionaries,dt,t} from '.';
import {useLocale} from '../stores/locale';
it('matches every bilingual key and placeholder',()=>{const { 'zh-CN':zh,'en-US':en}=dictionaries;expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort());for(const key of Object.keys(zh) as (keyof typeof zh)[])expect(zh[key].match(/\{\w+\}/g)?.sort()||[]).toEqual(en[key].match(/\{\w+\}/g)?.sort()||[]);});
it('translates data labels at render time',()=>{useLocale.setState({locale:'en-US'});expect(dt('训练集群-jp-5')).toBe('Training cluster-jp-5');expect(t('common.rows',{count:12})).toBe('12 records');useLocale.setState({locale:'zh-CN'});expect(t('nav.overview')).toBe('总览');});
