import { Navigate, Route, Routes } from 'react-router-dom';
import { TabBar } from './components/TabBar';
import { DemoBanner } from './components/ui';
import { AppProvider, useApp } from './lib/AppContext';
import { Absences } from './pages/Absences';
import { Login } from './pages/Login';
import { More } from './pages/More';
import { Overview } from './pages/Overview';
import { Plan } from './pages/Plan';
import { Tasks } from './pages/Tasks';

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}

function Shell() {
  const { currentMember, mode } = useApp();
  if (!currentMember) return <Login />;
  return (
    <div className="mx-auto min-h-screen max-w-md px-4 pb-28">
      {mode === 'local' && <DemoBanner />}
      <Routes>
        <Route path="/" element={<Navigate to="/overview" replace />} />
        <Route path="/overview" element={<Overview />} />
        <Route path="/plan" element={<Plan />} />
        <Route path="/absences" element={<Absences />} />
        <Route path="/tasks" element={<Tasks />} />
        <Route path="/more" element={<More />} />
        <Route path="*" element={<Navigate to="/overview" replace />} />
      </Routes>
      <TabBar />
    </div>
  );
}
