import React, { useState, useEffect } from 'react';
import CollectionPage from './pages/CollectionPage';
import AdminPage from './pages/AdminPage';
import PracticePage from './pages/PracticePage';

export default function App() {
  const [currentRoute, setCurrentRoute] = useState(window.location.hash);

  useEffect(() => {
    const handleHashChange = () => {
      setCurrentRoute(window.location.hash);
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  if (currentRoute === '#admin') {
    return <AdminPage />;
  }
  
  if (currentRoute === '#practice') {
    return <PracticePage />;
  }

  return <CollectionPage />;
}
