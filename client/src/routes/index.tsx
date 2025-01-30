import { createBrowserRouter, Navigate, Outlet } from 'react-router-dom';
import {
  Login,
  Registration,
  RequestPasswordReset,
  ResetPassword,
  VerifyEmail,
  ApiErrorWatcher,
} from '~/components/Auth';
import { AuthContextProvider } from '~/hooks/AuthContext';
import StartupLayout from './Layouts/Startup';
import LoginLayout from './Layouts/Login';
import dashboardRoutes from './Dashboard';
import ShareRoute from './ShareRoute';
import ChatRoute from './ChatRoute';
import Search from './Search';
import Root from './Root';
import { useAuthContext } from '~/hooks/AuthContext';
import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';


// Add this AutoLoginHandler component
const AutoLoginHandler = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { login, isAuthenticated } = useAuthContext();
  const email = searchParams.get('email');
  const password = searchParams.get('password');

  console.log(`email: ${email}`)
  console.log(`password: ${password}`)

  useEffect(() => {
    if (isAuthenticated) {
      navigate('/c/new', { replace: true });
      return;
    }

    const attemptLogin = async () => {
      if (!email || !password) {
        navigate('/login?error=Missing credentials', { replace: true });
        return;
      }

      try {
        await login({ email, password });
        navigate('/c/new', { replace: true });
        // Clear credentials from URL after successful login
        window.history.replaceState({}, document.title, window.location.pathname);
      } catch (error) {
        navigate(`/login?error=${encodeURIComponent(error.message)}`, { replace: true });
      }
    };

    attemptLogin();
  }, [email, password, navigate, isAuthenticated, login]);

  return null;
};



const AuthLayout = () => (
  <AuthContextProvider>
    <Outlet />
    <ApiErrorWatcher />
  </AuthContextProvider>
);

export const router = createBrowserRouter([
  {
    path: 'share/:shareId',
    element: <ShareRoute />,
  },
  {
    path: '/',
    element: <StartupLayout />,
    children: [
      {
        path: 'register',
        element: <Registration />,
      },
      {
        path: 'forgot-password',
        element: <RequestPasswordReset />,
      },
      {
        path: 'reset-password',
        element: <ResetPassword />,
      },
    ],
  },
  {
    path: 'verify',
    element: <VerifyEmail />,
  },
  {
    element: <AuthLayout />,
    children: [
      // Add the auto-login route here
      {
        path: 'auto-login',
        element: <AutoLoginHandler />,
      },
      {
        path: '/',
        element: <LoginLayout />,
        children: [
          {
            path: 'login',
            element: <Login />,
          },
        ],
      },
      dashboardRoutes,
      {
        path: '/',
        element: <Root />,
        children: [
          {
            index: true,
            element: <Navigate to="/c/new" replace={true} />,
          },
          {
            path: 'c/:conversationId?',
            element: <ChatRoute />,
          },
          {
            path: 'search',
            element: <Search />,
          },
        ],
      },
    ],
  },
]);
