import { createBrowserRouter,Navigate } from 'react-router-dom';
import ConsoleLayout from './layouts/ConsoleLayout';
import OverviewPage from '../features/overview/OverviewPage';
import { ErrorState } from '../components/ui';
import { ApiError } from '../lib/api-client';
export const router=createBrowserRouter([{path:'/',Component:ConsoleLayout,errorElement:<ErrorState error={new ApiError(500,'INTERNAL')}/>,children:[{index:true,element:<Navigate to="/overview" replace/>},{path:'overview',Component:OverviewPage},{path:'*',element:<ErrorState error={new ApiError(404,'NOT_FOUND')}/>}]}]);
