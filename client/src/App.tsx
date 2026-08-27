import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
import { AuthProvider, useAuth, useTheme } from './lib/auth';
import { AdminAnalytics } from './pages/admin/AdminAnalytics';
import { AdminAssessments } from './pages/admin/AdminAssessments';
import { AdminHealth } from './pages/admin/AdminHealth';
import { AdminHome } from './pages/admin/AdminHome';
import { AdminImportExport } from './pages/admin/AdminImportExport';
import { AdminLayout } from './pages/admin/AdminLayout';
import { AdminQuestionBuilder } from './pages/admin/AdminQuestionBuilder';
import { AdminQuestions } from './pages/admin/AdminQuestions';
import { AdminStudents } from './pages/admin/AdminStudents';
import { AssessmentAttempt } from './pages/AssessmentAttempt';
import { Assessments } from './pages/Assessments';
import { Dashboard } from './pages/Dashboard';
import { LeaderboardPage } from './pages/Leaderboard';
import { LearningPathPage } from './pages/LearningPath';
import { MasteryPage } from './pages/Mastery';
import { Login } from './pages/Login';
import { PracticeBrowser } from './pages/PracticeBrowser';
import { PracticeWorkspace } from './pages/PracticeWorkspace';
import { Submissions } from './pages/Submissions';

export function App() {
  const theme = useTheme();
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            element={
              <RequireAuth>
                <Layout theme={theme.theme} onToggleTheme={theme.toggle} />
              </RequireAuth>
            }
          >
            <Route index element={<Navigate to="/practice" replace />} />
            <Route path="/practice" element={<PracticeBrowser />} />
            <Route path="/practice/:qid" element={<PracticeWorkspace theme={theme.theme} />} />
            <Route path="/learning-path" element={<LearningPathPage />} />
            <Route path="/progress" element={<Dashboard />} />
            <Route path="/mastery" element={<MasteryPage />} />
            <Route path="/submissions" element={<Submissions />} />
            <Route path="/leaderboard" element={<LeaderboardPage />} />
            <Route path="/assessments" element={<Assessments />} />
            <Route path="/assessments/:attemptId" element={<AssessmentAttempt theme={theme.theme} />} />

            <Route path="/admin" element={<RequireAdmin><AdminLayout /></RequireAdmin>}>
              <Route index element={<AdminHome />} />
              <Route path="questions" element={<AdminQuestions />} />
              <Route path="questions/new" element={<AdminQuestionBuilder theme={theme.theme} />} />
              <Route path="questions/:id" element={<AdminQuestionBuilder theme={theme.theme} />} />
              <Route path="assessments" element={<AdminAssessments />} />
              <Route path="students" element={<AdminStudents />} />
              <Route path="analytics" element={<AdminAnalytics />} />
              <Route path="health" element={<AdminHealth />} />
              <Route path="import-export" element={<AdminImportExport />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/practice" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

function RequireAuth({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth();
  if (loading) {
    return <div className="grid min-h-screen place-items-center"><Spinner label="Starting" /></div>;
  }
  return user ? children : <Navigate to="/login" replace />;
}

function RequireAdmin({ children }: { children: JSX.Element }) {
  const { isAdmin, loading } = useAuth();
  if (loading) return <Spinner />;
  return isAdmin ? children : <Navigate to="/practice" replace />;
}
