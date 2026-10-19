import { setupWorker } from 'msw/browser';
import { handlers } from './handlers';
import { db } from './lib/database';
import { assertConsistency } from './lib/consistency';
export async function startMock(){if(import.meta.env.DEV&&import.meta.env.VITE_ENABLE_CONSISTENCY_CHECK!=='false')assertConsistency(db);const worker=setupWorker(...handlers);await worker.start({onUnhandledRequest:'bypass',quiet:true});return worker;}
