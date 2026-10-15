import React, { createContext, useContext, useState, useEffect } from 'react';

const RouterContext = createContext(null);

export function RouterProvider({ children }) {
  const [currentPath, setCurrentPath] = useState(window.location.pathname || '/');
  const [currentSearch, setCurrentSearch] = useState(window.location.search || '');

  useEffect(() => {
    const handlePopState = () => {
      setCurrentPath(window.location.pathname || '/');
      setCurrentSearch(window.location.search || '');
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigate = (to) => {
    const [pathPart, searchPart] = to.split('?');
    const targetPath = pathPart || '/';
    const targetSearch = searchPart ? `?${searchPart}` : '';
    
    if (window.location.pathname !== targetPath || window.location.search !== targetSearch) {
      window.history.pushState({}, '', to);
      setCurrentPath(targetPath);
      setCurrentSearch(targetSearch);
    }
  };

  return (
    <RouterContext.Provider value={{ currentPath, currentSearch, navigate }}>
      {children}
    </RouterContext.Provider>
  );
}

export function useRouter() {
  const context = useContext(RouterContext);
  if (!context) {
    throw new Error('useRouter must be used within a RouterProvider');
  }
  return context;
}
