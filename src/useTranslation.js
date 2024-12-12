import { useState, useEffect, useContext, useRef, useCallback } from 'react';
import { getI18n, getDefaults, ReportNamespaces, I18nContext } from './context.js';
import {
  warnOnce,
  loadNamespaces,
  loadLanguages,
  hasLoadedNamespace,
  isString,
  isObject,
} from './utils.js';

const usePrevious = (value, ignore) => {
  const ref = useRef();
  useEffect(() => {
    ref.current = ignore ? ref.current : value;
  }, [value, ignore]);
  return ref.current;
};

const alwaysNewT = (i18n, language, namespace, keyPrefix) =>
  i18n.getFixedT(language, namespace, keyPrefix);

const useMemoizedT = (i18n, language, namespace, keyPrefix) =>
  useCallback(alwaysNewT(i18n, language, namespace, keyPrefix), [
    i18n,
    language,
    namespace,
    keyPrefix,
  ]);

export const useTranslation = (ns, props = {}) => {
  // assert we have the needed i18nInstance
  const { i18n: i18nFromProps } = props;
  const { i18n: i18nFromContext, defaultNS: defaultNSFromContext } = useContext(I18nContext) || {};
  const i18n = i18nFromProps || i18nFromContext || getI18n();

  if (i18n && !i18n.reportNamespaces) i18n.reportNamespaces = new ReportNamespaces();
  if (!i18n) {
    warnOnce('You will need to pass in an i18next instance by using initReactI18next');
    const notReadyT = (k, optsOrDefaultValue) => {
      if (isString(optsOrDefaultValue)) return optsOrDefaultValue;
      if (isObject(optsOrDefaultValue) && isString(optsOrDefaultValue.defaultValue))
        return optsOrDefaultValue.defaultValue;
      return Array.isArray(k) ? k[k.length - 1] : k;
    };
    const retNotReady = [notReadyT, {}, false, { hasError: false, failedNamespaces: [] }];
    retNotReady.t = notReadyT;
    retNotReady.i18n = {};
    retNotReady.ready = false;
    retNotReady.error = { hasError: false, failedNamespaces: [] };
    return retNotReady;
  }

  if (i18n.options.react?.wait)
    warnOnce(
      'It seems you are still using the old wait option, you may migrate to the new useSuspense behaviour.',
    );

  const i18nOptions = { ...getDefaults(), ...i18n.options.react, ...props };
  const { useSuspense, keyPrefix } = i18nOptions;

  // prepare having a namespace
  let namespaces = ns || defaultNSFromContext || i18n.options?.defaultNS;
  namespaces = isString(namespaces) ? [namespaces] : namespaces || ['translation'];

  // report namespaces as used
  i18n.reportNamespaces.addUsedNamespaces?.(namespaces);

  // Determine if namespaces are ready by checking both initialization and namespace availability
  const ready =
    (i18n.isInitialized || i18n.initializedStoreOnce) &&
    namespaces.every((n) => i18n.hasResourceBundle(i18n.language, n));

  // binding t function to namespace (acts also as rerender trigger *when* args have changed)
  const memoGetT = useMemoizedT(
    i18n,
    props.lng || null,
    i18nOptions.nsMode === 'fallback' ? namespaces : namespaces[0],
    keyPrefix,
  );

  const getT = () => memoGetT;
  const getNewT = () =>
    alwaysNewT(
      i18n,
      props.lng || null,
      i18nOptions.nsMode === 'fallback' ? namespaces : namespaces[0],
      keyPrefix,
    );

  const [t, setT] = useState(getT);
  const [error, setError] = useState({ hasError: false, failedNamespaces: [] });

  let joinedNS = namespaces.join();
  if (props.lng) joinedNS = `${props.lng}${joinedNS}`;
  const previousJoinedNS = usePrevious(joinedNS);

  const isMounted = useRef(true);

  useEffect(() => {
    const { bindI18n, bindI18nStore } = i18nOptions;
    isMounted.current = true;

    const updateErrorState = (failedNamespaces) => {
      setError({
        hasError: failedNamespaces.length > 0,
        failedNamespaces,
      });
    };

    const loadCallback = (err) => {
      if (isMounted.current) {
        const failedNamespaces = namespaces.filter(
          (n) => !i18n.hasResourceBundle(i18n.language, n),
        );
        if (err || failedNamespaces.length > 0) {
          updateErrorState(failedNamespaces);
        } else {
          updateErrorState([]);
        }
        setT(getNewT);
      }
    };

    // Load namespaces if not ready
    if (!ready && !useSuspense) {
      if (props.lng) {
        loadLanguages(i18n, props.lng, namespaces, loadCallback);
      } else {
        loadNamespaces(i18n, namespaces, loadCallback);
      }
    }

    if (ready && previousJoinedNS && previousJoinedNS !== joinedNS && isMounted.current) {
      updateErrorState([]);
      setT(getNewT);
    }

    const boundReset = () => {
      if (isMounted.current) setT(getNewT);
    };

    // bind events to trigger change, like languageChanged
    if (bindI18n) i18n?.on(bindI18n, boundReset);
    if (bindI18nStore) i18n?.store.on(bindI18nStore, boundReset);

    // unbinding on unmount
    return () => {
      isMounted.current = false;
      if (i18n) bindI18n?.split(' ').forEach((e) => i18n.off(e, boundReset));
      if (bindI18nStore && i18n)
        bindI18nStore.split(' ').forEach((e) => i18n.store.off(e, boundReset));
    };
  }, [i18n, joinedNS]); // re-run effect whenever list of namespaces changes

  useEffect(() => {
    if (isMounted.current && ready) {
      setError({ hasError: false, failedNamespaces: [] });
      setT(getT);
    }
  }, [i18n, keyPrefix, ready]); // re-run when i18n instance or keyPrefix were replaced

  const ret = [t, i18n, ready, error]; // Include error in tuple response
  ret.t = t;
  ret.i18n = i18n;
  ret.ready = ready;
  ret.error = error;

  // return hook stuff if ready
  if (ready) return ret;

  // not yet loaded namespaces -> load them -> and return if useSuspense option set false
  if (!ready && !useSuspense) return ret;

  // not yet loaded namespaces -> load them -> and trigger suspense
  throw new Promise((resolve) => {
    const loadCallback = (err) => {
      const failedNamespaces = namespaces.filter(
        (n) => !i18n.hasResourceBundle(i18n.language, n),
      );
      if (err || failedNamespaces.length > 0) {
        setError({
          hasError: true,
          failedNamespaces,
        });
      }
      resolve();
    };

    if (props.lng) {
      loadLanguages(i18n, props.lng, namespaces, loadCallback);
    } else {
      loadNamespaces(i18n, namespaces, loadCallback);
    }
  });
};

