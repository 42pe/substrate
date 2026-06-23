import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { Layout, RouteError } from './routes/Layout.js';
import { Overview } from './routes/Overview.js';
import { Boards } from './routes/Boards.js';
import { BoardDetail } from './routes/BoardDetail.js';
import { TaskDetail } from './routes/TaskDetail.js';
import { Activity } from './routes/Activity.js';
import { NotFound } from './components/States.js';
import './styles.css';

const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <Overview /> },
      { path: 'boards', element: <Boards /> },
      { path: 'boards/:id', element: <BoardDetail /> },
      { path: 'tasks/:id', element: <TaskDetail /> },
      { path: 'activity', element: <Activity /> },
      { path: '*', element: <NotFound /> },
    ],
  },
]);

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('No #root element found in index.html');
}

createRoot(rootEl).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
