import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MotionConfig } from 'framer-motion';
import { Toaster } from '@soapay/ui';
import { wagmiConfig } from './wagmi.js';
import { App } from './App.js';

/** `?motion=off` disables every animation (QA, screenshots, automation). */
const motionOff = typeof location !== 'undefined' && new URLSearchParams(location.search).get('motion') === 'off';

function Root() {
  const [qc] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={qc}>
        <MotionConfig reducedMotion={motionOff ? 'always' : 'user'}>
          <App />
          <Toaster />
        </MotionConfig>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
