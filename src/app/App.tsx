import { useEffect } from 'react';
import { HomePage } from '../pages/HomePage';
import { LearnPage } from '../pages/LearnPage';
import { ProjectsPage } from '../pages/ProjectsPage';
import { WorkspacePage } from '../pages/WorkspacePage';
import { ConfirmHost } from '../ui/Confirm';
import { IconDefs } from '../ui/icons';
import { Toast } from '../ui/Toast';
import { useRoute } from './router';
import { applyTheme } from './theme';

export function App() {
  const route = useRoute();
  useEffect(applyTheme, []);
  useEffect(() => {
    const titles = { home: 'Networky', projects: 'Projects · Networky', learn: 'Learn · Networky', workspace: 'Workspace · Networky' };
    document.title = titles[route.page];
  }, [route.page]);

  return (
    <>
      <IconDefs />
      {route.page === 'home' && <HomePage />}
      {route.page === 'projects' && <ProjectsPage />}
      {route.page === 'learn' && <LearnPage />}
      {route.page === 'workspace' && <WorkspacePage projectId={route.projectId} />}
      <Toast />
      <ConfirmHost />
    </>
  );
}
