// main.js
// Orchestrates components: state manager, code editors, database querying, and table rendering
import './bootstrap.js';
import 'jquery-ui/dist/jquery-ui.js';
import state from './components/state.js';
import CodeEditor from './components/CodeEditor.js';
import DB from './components/db.js';
import ResultTable from './components/ResultTable.js';
import ErrorMessage from './components/ErrorMessage.js';
import ResizeHandle from './components/ResizeHandle.js';
import {
  DEFAULT_DATABASE_ID,
  getDatabaseConfig,
  isKnownDatabaseId,
  listDatabaseConfigs,
} from './components/databaseCatalog.js';
import { toggleFavicon } from './components/favicons.js';
import { copyToClipboard, showToast } from './util.js';

const app = {
  db: null,
  dbLoadToken: 0,
  sqlEditor: null,
  resultTable: null,
  sampleQueriesByValue: new Map(),
  sampleQueriesSelect: null,
  databaseSelect: null,
  rEditor: null,
  repl: null,
};

const quoteIdentifier = (name) => `"${String(name).replaceAll('"', '""')}"`;
const minimalRCode = () => `to_svg <- svgstring(width = output.width.inch, height = output.height.inch, scaling = 1)
theme_set(theme_bw())

### the current table is bound to the variable 'df'
output <- ggplot(df, aes()) +
  annotate(geom = 'text', x = 0, y = 0, label = 'Plot something!')

## output to the html page
plot(output); dev.off(); to_svg()`;

function getSampleState(sample) {
  const layoutType = sample?.layout || (sample?.r_code ? 'split' : 'table');
  return {
    sqlQuery: sample?.sql_code ?? '',
    rCode: sample?.r_code || minimalRCode(),
    layout: { type: sample?.r_code ? layoutType : 'table' },
  };
}

async function runQuery() {
  if (!app.db) {
    return;
  }

  state.setState({ sqlError: 'loading', sqlWarning: '' });
  const query = state.getState().sqlQuery;
  let result;
  try {
    result = await app.db.query(query);
  } catch (err) {
    result = { error: err.toString() };
  }

  if (result.error) {
    state.setState({ result: { columns: [], rows: [], query }, sqlError: result.error, sqlWarning: '' });
    return;
  }

  const newState = { result: { columns: result.columns, rows: result.rows, query }, sqlError: '', sqlWarning: '' };
  state.setState('warning' in result ? { ...newState, sqlWarning: result.warning } : newState);
}

function renderCsvStatus(newState) {
  const elem = document.getElementById('csv-status');
  const { csvStatusText, csvStatusType } = newState;
  elem.textContent = csvStatusType === 'loading' ? 'Importing CSV...' : csvStatusText;
  elem.classList.toggle('is-error', csvStatusType === 'error');
  elem.classList.toggle('is-success', csvStatusType === 'success');
}

function renderImportedTables(newState) {
  const elem = document.getElementById('imported-tables');
  if (!newState.importedTables.length) {
    elem.textContent = '';
    return;
  }
  elem.textContent = `Session tables: ${newState.importedTables.join(', ')}`;
}

function renderDatabaseSelect(activeDatabaseId) {
  if (!app.databaseSelect) {
    return;
  }

  if (!app.databaseSelect.options.length) {
    app.databaseSelect.innerHTML = '';
    for (const config of listDatabaseConfigs()) {
      const option = document.createElement('option');
      option.value = config.id;
      option.textContent = config.label;
      option.title = config.fileName;
      app.databaseSelect.appendChild(option);
    }
  }

  if (activeDatabaseId && app.databaseSelect.value !== activeDatabaseId) {
    app.databaseSelect.value = activeDatabaseId;
  }
}

function renderSampleQueries(samples = [], selectedSql = '') {
  if (!app.sampleQueriesSelect) {
    return;
  }

  app.sampleQueriesByValue = new Map();
  const groups = new Map();
  for (const sample of samples) {
    const group = sample.group || 'Other';
    if (!groups.has(group)) {
      groups.set(group, []);
    }
    groups.get(group).push(sample);
  }

  app.sampleQueriesSelect.innerHTML = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.disabled = true;
  placeholder.textContent = samples.length ? 'Select Example' : 'No Examples';
  app.sampleQueriesSelect.appendChild(placeholder);

  for (const [group, groupSamples] of groups.entries()) {
    const optgroup = document.createElement('optgroup');
    optgroup.label = group;
    for (const sample of groupSamples) {
      const value = `${group}::${sample.description}`;
      app.sampleQueriesByValue.set(value, sample);
      const option = document.createElement('option');
      option.value = value;
      option.textContent = sample.description;
      optgroup.appendChild(option);
    }
    app.sampleQueriesSelect.appendChild(optgroup);
  }

  syncSampleQuerySelection(selectedSql);
}

function syncSampleQuerySelection(selectedSql = '') {
  if (!app.sampleQueriesSelect) {
    return;
  }

  for (const [value, sample] of app.sampleQueriesByValue.entries()) {
    if (sample.sql_code === selectedSql) {
      app.sampleQueriesSelect.value = value;
      return;
    }
  }
  app.sampleQueriesSelect.value = '';
}

function handleSampleQuerySelection(sample) {
  const updates = {
    ...getSampleState(sample),
    runningQuery: true,
  };

  state.setState(updates);
  toggleFavicon(false);
  runQuery();
}

async function loadDatabase(dbId, { resetSqlQuery = false } = {}) {
  const requestedDbId = dbId || DEFAULT_DATABASE_ID;
  const dbConfig = getDatabaseConfig(requestedDbId);
  const invalidRequestedDb = !isKnownDatabaseId(requestedDbId);
  const loadToken = ++app.dbLoadToken;
  const shouldResetSqlQuery = resetSqlQuery || !state.hasUrlState();

  if (invalidRequestedDb) {
    showToast(`Database "${requestedDbId}" is not available. Loaded ${dbConfig.label} instead.`, 'error');
  }

  state.setState({
    dbId: dbConfig.id,
    sqlError: 'loading',
    sqlWarning: '',
    rError: 'loading',
    rOutput: '',
    csvStatusText: '',
    csvStatusType: 'idle',
    importedTables: [],
  });

  renderDatabaseSelect(dbConfig.id);
  const rOutputElem = document.getElementById('r-output');
  if (rOutputElem) {
    rOutputElem.innerHTML = '';
  }

  if (app.db) {
    const previousDb = app.db;
    app.db = null;
    await previousDb.close();
  }

  const nextDb = await DB.create({
    dbUrl: dbConfig.dbUrl,
    fileName: dbConfig.fileName,
  });

  if (loadToken !== app.dbLoadToken) {
    await nextDb.close();
    return;
  }

  app.db = nextDb;

  let initialSqlQuery = state.getState().sqlQuery;
  let initialRCode = state.getState().rCode;
  let initialLayout = state.getState().layout;
  if (shouldResetSqlQuery) {
    const defaultSample = dbConfig.sampleQueries[0];
    if (defaultSample) {
      const sampleState = getSampleState(defaultSample);
      initialSqlQuery = sampleState.sqlQuery;
      initialRCode = sampleState.rCode;
      initialLayout = sampleState.layout;
      state.setState(sampleState);
    } else {
      initialSqlQuery = await nextDb.getPreviewQuery();
      initialRCode = minimalRCode();
      initialLayout = { type: 'table' };
      state.setState({
        sqlQuery: initialSqlQuery,
        rCode: initialRCode,
        layout: initialLayout,
      });
    }
  }

  state.setState({
    sqlError: 'loading',
    sqlWarning: '',
    rError: 'loading',
    rOutput: '',
    csvStatusText: '',
    csvStatusType: 'idle',
    importedTables: [],
    rCode: initialRCode,
    layout: initialLayout,
    result: { columns: [], rows: [], query: initialSqlQuery },
  });

  renderSampleQueries(dbConfig.sampleQueries, initialSqlQuery);
  renderDatabaseSelect(dbConfig.id);
  state.saveState();

  await runQuery();
}

async function boot() {
  app.sqlEditor = new CodeEditor('#sql-editor', {
    mode: 'text/x-sql',
    stateKey: 'sqlQuery',
  });
  app.sqlError = new ErrorMessage('#sql-status', ['sqlError', 'sqlWarning']);
  app.resultTable = new ResultTable('#sql-output');
  app.sampleQueriesSelect = document.getElementById('sample-queries');
  app.databaseSelect = document.getElementById('database-select');

  if (app.sampleQueriesSelect) {
    app.sampleQueriesSelect.addEventListener('change', (event) => {
      const sample = app.sampleQueriesByValue.get(event.target.value);
      if (sample) {
        handleSampleQuerySelection(sample);
      }
    });
  }

  if (app.databaseSelect) {
    app.databaseSelect.addEventListener('change', async (event) => {
      const selectedDbId = event.target.value;
      if (selectedDbId === state.getState().dbId) {
        return;
      }
      await loadDatabase(selectedDbId, { resetSqlQuery: true });
    });
  }

  state.subscribe((newState) => renderCsvStatus(newState), ['csvStatusText', 'csvStatusType']);
  state.subscribe((newState) => renderImportedTables(newState), ['importedTables']);
  state.subscribe((newState) => {
    if (!newState.result) {
      return;
    }
    const { columns, rows, query } = newState.result;
    app.resultTable.render(columns, rows, query);
  }, ['result', 'viewsize', 'layout']);
  state.subscribe((newState) => {
    syncSampleQuerySelection(newState.sqlQuery);
  }, ['sqlQuery']);
  state.subscribe((newState) => {
    const dbConfig = getDatabaseConfig(newState.dbId);
    renderDatabaseSelect(dbConfig.id);
  }, ['dbId']);

  renderCsvStatus(state.getState());
  renderImportedTables(state.getState());
  renderDatabaseSelect(state.getState().dbId);

  document.getElementById('load-table').addEventListener('click', async (e) => {
    e.preventDefault();
    await runQuery();
  });

  document.getElementById('csv-upload').addEventListener('change', async (event) => {
    if (!app.db) {
      return;
    }

    const [file] = event.target.files || [];
    event.target.value = '';
    if (!file) {
      return;
    }

    state.setState({ csvStatusType: 'loading', csvStatusText: '', sqlError: '', sqlWarning: '' });
    const imported = await app.db.importCSV(file);
    if (imported.error) {
      state.setState({
        csvStatusType: 'error',
        csvStatusText: imported.error.join(' '),
      });
      return;
    }

    const nextTables = [...state.getState().importedTables, imported.tableName];
    state.setState({
      csvStatusType: 'success',
      csvStatusText: `Imported ${file.name} as ${imported.tableName}.`,
      importedTables: nextTables,
      sqlQuery: `SELECT *\nFROM ${quoteIdentifier(imported.tableName)}\nLIMIT 100`,
    });
    await runQuery();
  });

  document.addEventListener('keydown', (event) => {
    if (event.ctrlKey && event.key === 'Enter') {
      runQuery();
    }
  });

  $('#share-btn').click(() => {
    copyToClipboard(window.location.href, 'Link copied to clipboard!');
  });

  $('#reset-btn').click(() => {
    const newUrl = window.location.origin + window.location.pathname;
    window.location = newUrl;
  });

  app.resizeHandle = new ResizeHandle('#app', '#grid-resize', '#toggle-viz-btn');

  await loadDatabase(state.getState().dbId, { resetSqlQuery: !state.hasUrlState() });

  app.rError = new ErrorMessage('#r-status', 'rError');
  app.rEditor = new CodeEditor('#r-editor', {
    mode: 'text/x-rsrc',
    stateKey: 'rCode',
    overrides: { lineNumbers: false },
  });

  const RRepl = await import('./components/RRepl.js');
  const outputElem = 'r-output';
  app.repl = await RRepl.default.initialize(outputElem);

  async function evalR(viewOnly = false) {
    state.setState({ rError: 'loading' });
    const { rCode, result } = state.getState();
    const res = await app.repl.eval(rCode, result, viewOnly);
    if (res.error) {
      state.setState({ rError: res.error });
      return;
    }

    state.setState({ rError: '', rOutput: res.svg });
    document.getElementById(outputElem).innerHTML = res.svg;
  }

  state.subscribe((newState, updates) => {
    if (newState.sqlError) {
      return;
    }
    if ('layout' in updates) {
      app.rEditor.refresh();
    }
    if (!('runningQuery' in updates)) {
      evalR(!('result' in updates));
    }
  }, ['result', 'viewsize', 'layout']);

  state.subscribe((newState, updates) => {
    if (newState.sqlError || newState.rError) {
      return;
    }
    if ('result' in updates || 'rOutput' in updates) {
      state.saveState();
    }
    if ('rOutput' in updates) {
      const dl = $('#svg-dl-btn');
      const blob = new Blob([newState.rOutput], { type: 'image/svg+xml' });
      const newUrl = URL.createObjectURL(blob);
      const oldUrl = dl.attr('href');
      if (!!oldUrl) {
        URL.revokeObjectURL(oldUrl);
      }
      dl.attr('download', 'cloudspecs-plot.svg').attr('href', newUrl);
    }
  }, ['result', 'rOutput']);

  await evalR();
}

document.addEventListener('DOMContentLoaded', () => {
  boot().catch((error) => {
    console.error('Failed to initialize CloudSpecs', error);
    showToast('Failed to initialize the application', 'error');
  });
});
