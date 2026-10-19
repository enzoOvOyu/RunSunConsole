import { describe,it,expect } from 'vitest';
import { KINDS } from '../types/domain';
import { KIND_META,displayId } from './ids';
describe('resource identifiers',()=>{it('uses one canonical route and prefix per kind',()=>{expect(new Set(KINDS.map(k=>KIND_META[k].routeKey)).size).toBe(4);for(const kind of KINDS)expect(displayId(kind,'8a9d0026-1017-4000-8000-000000000012')).toMatch(new RegExp(`^${KIND_META[kind].prefix}[a-z0-9]{6}$`));});});
