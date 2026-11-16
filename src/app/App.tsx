import { useEffect } from 'react';
import { DrillSetPage, DrillsPage } from '../pages/DrillsPage';
import { HomePage } from '../pages/HomePage';
import { LeaderboardPage } from '../pages/LeaderboardPage';
import { LearnPage } from '../pages/LearnPage';
import { ProblemPage } from '../pages/ProblemPage';
import { ProblemsPage } from '../pages/ProblemsPage';
import { ProfilePage } from '../pages/ProfilePage';
import { ProjectsPage } from '../pages/ProjectsPage';
import { WorkspacePage } from '../pages/WorkspacePage';
import { drillKind } from '../drills';
import { problemBySlug } from '../problems/catalog';
import { EngineBanner } from '../ui/AccountMenu';
import { ConfirmHost } from '../ui/Confirm';
import { ImportBanner } from '../ui/ImportBanner';
import { IconDefs } from '../ui/icons';
import { Toast } from '../ui/Toast';
import { LabLink } from './LabLink';
import { useRoute, type Route } from './router';
import { applyTheme } from './theme';

function title(route: Route): string {
  switch (route.page) {
    case 'home':
      return 'Networky';
    case 'problems':
      return 'Problems · Networky';
    case 'problem':
      return `${problemBySlug(route.slug)?.title ?? 'Problem'} · Networky`;
    case 'projects':
      return 'Projects · Networky';
    case 'learn':
      return 'Learn · Networky';
    case 'leaderboard':
      return 'Leaderboard · Networky';
    case 'workspace':
      return 'Playground · Networky';
    case 'lab':
      return 'Opening lab · Networky';
    case 'profile':
      return `@${route.handle} · Networky`;
    case 'drills':
      return 'Drills · Networky';
    case 'drill':
      return `${drillKind(route.kind)?.title ?? 'Drill'} · Networky`;
  }
}

export function App() {
  const route = useRoute();
  useEffect(applyTheme, []);
  const t = title(route);
  useEffect(() => {
    document.title = t;
  }, [t]);

  return (
    <>
      <IconDefs />
      {route.page === 'home' && <HomePage />}
      {route.page === 'problems' && <ProblemsPage />}
      {route.page === 'problem' && <ProblemPage key={route.slug} slug={route.slug} />}
      {route.page === 'projects' && <ProjectsPage />}
      {route.page === 'learn' && <LearnPage />}
      {route.page === 'leaderboard' && <LeaderboardPage />}
      {route.page === 'profile' && <ProfilePage key={route.handle} handle={route.handle} />}
      {route.page === 'drills' && <DrillsPage />}
      {route.page === 'drill' && <DrillSetPage key={`${route.kind}:${route.level}:${route.seed ?? ''}`} kind={route.kind} level={route.level} seed={route.seed} />}
      {route.page === 'workspace' && <WorkspacePage projectId={route.projectId} />}
      {route.page === 'lab' && <LabLink labId={route.labId} />}
      <ImportBanner />
      <EngineBanner />
      <Toast />
      <ConfirmHost />
    </>
  );
}
