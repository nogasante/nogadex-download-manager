/**
 * useAppConfig — gives components the remote-managed app particulars
 * (GitHub links, contact email, site URL, branding).
 *
 * Renders immediately with the baked defaults, then re-renders once the
 * server returns (possibly fresher) remote config. Components never block
 * and never see a loading state.
 */
import { useEffect, useState } from 'react';
import { BAKED_APP_CONFIG, NdmAppConfig } from '../../shared/app_config';
import { api } from '../api/client';

let cache: NdmAppConfig | null = null;
let fetchStarted = false;
const listeners = new Set<(c: NdmAppConfig) => void>();

const startFetch = (): void => {
  if (fetchStarted) return;
  fetchStarted = true;
  api.appConfig
    .get()
    .then((cfg) => {
      if (cfg && cfg.github?.repoUrl) {
        cache = cfg;
        listeners.forEach((l) => l(cfg));
      }
    })
    .catch(() => {
      /* baked defaults already in use */
    });
};

export const useAppConfig = (): NdmAppConfig => {
  const [config, setConfig] = useState<NdmAppConfig>(cache || BAKED_APP_CONFIG);

  useEffect(() => {
    listeners.add(setConfig);
    startFetch();
    return () => {
      listeners.delete(setConfig);
    };
  }, []);

  return config;
};
