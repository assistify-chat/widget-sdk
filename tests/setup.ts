import { afterEach } from 'vitest';
import { __resetMountForTests } from '../src/mount';
import { __resetQueueForTests } from '../src/queue';
import { __resetReactSingletonForTests } from '../src/react';

// Tell React this environment supports act() for client-component tests.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  __resetMountForTests();
  __resetQueueForTests();
  __resetReactSingletonForTests();
  if (typeof window !== 'undefined') {
    delete (window as Record<string, unknown>).Assistify;
    delete (window as Record<string, unknown>).CHATBOT_CONFIG;
    document.head.querySelectorAll('script').forEach((s) => s.remove());
    document.cookie.split(';').forEach((c) => {
      const eq = c.indexOf('=');
      const name = eq > -1 ? c.slice(0, eq).trim() : c.trim();
      if (name.startsWith('assistify.')) {
        document.cookie = `${name}=; Max-Age=0; Path=/`;
      }
    });
    window.localStorage.clear();
  }
});
