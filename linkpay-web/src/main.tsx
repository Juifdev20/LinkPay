import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import App from './App';
import { setupAutoUpdate } from './lib/pwa-update';
import { queryClient, queryPersister, queryCacheBuster, QUERY_CACHE_MAX_AGE } from './lib/query-client';
// Poppins bundled with the app (latin subset only) — never a network
// request before the first paint.
import '@fontsource/poppins/latin-400.css';
import '@fontsource/poppins/latin-500.css';
import '@fontsource/poppins/latin-600.css';
import '@fontsource/poppins/latin-700.css';
import '@fontsource/poppins/latin-800.css';
import './index.css';

setupAutoUpdate();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister: queryPersister,
        maxAge: QUERY_CACHE_MAX_AGE,
        buster: queryCacheBuster,
        dehydrateOptions: {
          // Only finished, successful reads are worth showing on next launch.
          shouldDehydrateQuery: (q) => q.state.status === 'success',
        },
      }}
    >
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </PersistQueryClientProvider>
  </React.StrictMode>,
);
