import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import { ApiError, type DesktopConfig } from '@gameserver/shared';
import App from './App';
import { desktop, isDesktop } from './desktop/bridge';
import { DesktopProvider } from './desktop/DesktopProvider';
import './i18n';
import './index.css';
import { api } from './lib/api';
import { CustomCssInjector } from './components/Branding';
import { AuthProvider } from './lib/auth';
import { ThemeProvider } from './lib/theme';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < (isDesktop ? 1 : 2),
    },
  },
});

async function bootstrap() {
  let desktopConfig: DesktopConfig | null = null;
  if (isDesktop) {
    // Desktop-Client: Server-Adresse und Device-Token kommen aus der lokalen Konfiguration
    desktopConfig = await desktop.getConfig();
    api.baseUrl = desktopConfig.serverUrl ?? '';
    api.token = desktopConfig.token;
  }
  // In der Tauri-WebView gibt es keinen Server für SPA-Pfade → Hash-Routing
  const Router = isDesktop ? HashRouter : BrowserRouter;
  const withDesktop = (children: ReactNode) =>
    desktopConfig ? <DesktopProvider initialConfig={desktopConfig}>{children}</DesktopProvider> : children;

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <Router>
            {withDesktop(
              <AuthProvider>
                <CustomCssInjector />
                <App />
              </AuthProvider>,
            )}
          </Router>
        </ThemeProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
}

void bootstrap();
