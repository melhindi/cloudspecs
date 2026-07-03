// Central state manager for application
// Provides subscribe, getState, setState, and syncs state with URL

// Helper functions for Base64 encoding/decoding of URI components
import LZString from 'lz-string';
import { setGlobalError } from '../util.js'
import { DEFAULT_DATABASE_ID, getDatabaseConfig } from './databaseCatalog.js';
const encodeForURI = (str) => LZString.compressToEncodedURIComponent(str);
const decodeFromURI = (str) => {
  try {
    return LZString.decompressFromEncodedURIComponent(str);
  } catch (e){
    console.error('Error decoding URI string', e);
    return '';
  }
}

const getQueryParam = (name) => {
  const params = new URLSearchParams(window.location.search);
  return params.get(name);
}

const STATE_PARAM = 'state';
const URL_ENCODED_KEYS = ['dbId', 'sqlQuery', 'rCode', 'layout'];
const REQUIRED_URL_KEYS = ['sqlQuery', 'rCode', 'layout'];
// Default state values
const defaultState = {
  dbId: DEFAULT_DATABASE_ID,
  // default SQL query to run
  sqlQuery: getDatabaseConfig(DEFAULT_DATABASE_ID)?.defaultSqlQuery ?? '',
  // initial R code to run
  rCode: //
    `to_svg <- svgstring(width = output.width.inch, height = output.height.inch, scaling = 1)

### the current table is bound to the variable 'df'
output <- ggplot(df, aes()) +
  annotate(geom = 'text', x = 0, y = 0, label = 'Plot something!')

plot(output); dev.off(); to_svg() # output to the html page`,
  sqlError: 'loading',
  sqlWarning: '',
  rError: 'loading',
  csvStatusText: '',
  csvStatusType: 'idle',
  importedTables: [],
  layout: { type: 'table' }
};

let state = (() => {
  const encoded = getQueryParam(STATE_PARAM);
  if (!!encoded) {
    try {
      const decoded = decodeFromURI(encoded);
      const parsed = JSON.parse(decoded);
      // console.log('decoded state ', parsed);
      if (
        Object.keys(parsed).every(key => URL_ENCODED_KEYS.includes(key))
        && REQUIRED_URL_KEYS.every(key => parsed.hasOwnProperty(key))
      ) {
        return { ...defaultState, ...parsed };
      }
    } catch (e) {
      console.error('Error parsing URL state', e);
    }
  }
  return { ...defaultState };
})();
const hasEncodedState = !!getQueryParam(STATE_PARAM);
let subscribers = [];
let subscriptionPaths = new Map();

// Subscribe to state changes. Callback receives (newState, updates).  Returns an unsubscribe function.
const subscribe = (callback, paths = []) => {
  subscribers.push(callback);
  if (paths.length > 0) { subscriptionPaths.set(callback, new Set(paths)); }
  return () => {
    subscribers = subscribers.filter(fn => fn !== callback);
    subscriptionPaths.delete(callback);
  };
}

// Get a shallow copy of current state
const getState = () => ({ ...state });

// Merge updates into state, notify subscribers, and sync URL
const setState = (updates) => {
  // console.log('updating state with ', updates);
  state = { ...state, ...updates };
  const snapshot = getState();
  subscribers.forEach(cb => {
    if (Object.keys(updates).some(key => // paths empty or includes key
      !subscriptionPaths.has(cb) || subscriptionPaths.get(cb).has(key))
    ) {
      cb(snapshot, updates);
    }
  });
}

const saveState = () => {
  // update URL without reloading only encode specific keys
  const toEncode = Object.fromEntries(Object.entries(state).filter(([key]) => URL_ENCODED_KEYS.includes(key)));
  const newEncoded = encodeForURI(JSON.stringify(toEncode));
  // console.log('encoding ', newEncoded.length, ' bytes');
  const newUrl = window.location.origin + window.location.pathname + '?' + STATE_PARAM + '=' + newEncoded;
  if (newUrl.length > 4096) {
    setGlobalError(`Warning: the URL state is ${newUrl.length} bytes long. Your browsers may refuse to open it when you reload the page or try to share it.`);
  } else {
    setGlobalError('');
  }
  window.history.replaceState(null, '', newUrl);
  // window.history.pushState(null, '', newUrl);
}

export default { subscribe, getState, setState, saveState, hasUrlState: () => hasEncodedState };
