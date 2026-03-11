import { useState, useEffect } from 'react'
import { DirectImport } from './pages/DirectImport'
import { AdminLogin } from './pages/admin/AdminLogin'
import { AdminDashboard } from './pages/admin/AdminDashboard'

function App() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminPassword, setAdminPassword] = useState<string | null>(null);

  useEffect(() => {
    setIsAdmin(window.location.pathname === '/admin');
    const saved = sessionStorage.getItem('admin_password');
    if (saved) setAdminPassword(saved);
  }, []);

  if (isAdmin) {
    if (!adminPassword) {
      return (
        <AdminLogin
          onLogin={(pw) => {
            sessionStorage.setItem('admin_password', pw);
            setAdminPassword(pw);
          }}
        />
      );
    }
    return (
      <AdminDashboard
        password={adminPassword}
        onLogout={() => {
          sessionStorage.removeItem('admin_password');
          setAdminPassword(null);
        }}
      />
    );
  }

  return <DirectImport />
}

export default App
