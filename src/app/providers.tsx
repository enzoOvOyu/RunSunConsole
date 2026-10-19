import { QueryClient,QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
export const queryClient=new QueryClient({defaultOptions:{queries:{staleTime:15_000,retry:1,refetchOnWindowFocus:false}}});
export async function initialize(){if(import.meta.env.VITE_ENABLE_MOCK!=='false'){const {startMock}=await import('../mocks/browser');await startMock();}}
export function Providers({children}:{children:ReactNode}){return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;}
