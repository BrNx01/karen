import { createContext, useContext, useMemo, type ReactNode, type JSX } from 'react';
import { translate, type Key, type Locale } from '../../shared/i18n/index.js';

type I18nValue = {
  locale: Locale;
  t: (key: Key, vars?: Record<string, string | number>) => string;
};

const I18nContext = createContext<I18nValue>({
  locale: 'en',
  t: (key, vars) => translate('en', key, vars),
});

export function I18nProvider(props: { locale: Locale; children: ReactNode }): JSX.Element {
  const value = useMemo<I18nValue>(
    () => ({
      locale: props.locale,
      t: (key, vars) => translate(props.locale, key, vars),
    }),
    [props.locale],
  );
  return <I18nContext.Provider value={value}>{props.children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  return useContext(I18nContext);
}
