const duckdbAssetModules = import.meta.glob('../static/*.duckdb', {
  eager: true,
  query: '?url',
  import: 'default',
});

const sampleQueryModules = import.meta.glob('../static/*.json', {
  eager: true,
  import: 'default',
});

const normalizeSnippet = (value) => {
  if (Array.isArray(value)) {
    return value.join('\n').trim();
  }
  return String(value ?? '').trim();
};

const normalizeQueries = (queries = []) => queries.map((item) => ({
  ...item,
  sql_code: normalizeSnippet(item.sql_code),
  r_code: normalizeSnippet(item.r_code),
  group: item.group ?? 'Other',
}));

const getStem = (path) => path.split('/').pop().replace(/\.duckdb$/i, '');

const humanizeLabel = (dbId) => {
  return dbId
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => {
      const lower = part.toLowerCase();
      if (lower === 'io') {
        return 'IO';
      }
      if (lower === 'sql') {
        return 'SQL';
      }
      if (lower === 'db') {
        return 'DB';
      }
      return `${lower.charAt(0).toUpperCase()}${lower.slice(1)}`;
    })
    .join(' ');
};

const buildDatabaseConfigs = () => {
  const configs = Object.entries(duckdbAssetModules).map(([path, dbUrl]) => {
    const fileName = path.split('/').pop();
    const id = getStem(path);
    const sidecarPath = path.replace(/\.duckdb$/i, '.json');
    const sidecarQueries = sampleQueryModules[sidecarPath];
    const sampleQueries = normalizeQueries(sidecarQueries ?? []);
    const defaultSqlQuery = sampleQueries[0]?.sql_code ?? null;

    return {
      id,
      label: humanizeLabel(id),
      fileName,
      dbUrl,
      defaultSqlQuery,
      sampleQueries,
    };
  });

  return configs.sort((a, b) => a.label.localeCompare(b.label));
};

export const DATABASE_CONFIGS = buildDatabaseConfigs();
export const DATABASES = Object.fromEntries(DATABASE_CONFIGS.map((config) => [config.id, config]));
export const DEFAULT_DATABASE_ID = DATABASE_CONFIGS[0]?.id ?? '';

export function getDatabaseConfig(dbId = DEFAULT_DATABASE_ID) {
  return DATABASES[dbId] ?? DATABASES[DEFAULT_DATABASE_ID] ?? DATABASE_CONFIGS[0];
}

export function isKnownDatabaseId(dbId) {
  return Object.prototype.hasOwnProperty.call(DATABASES, dbId);
}

export function listDatabaseConfigs() {
  return DATABASE_CONFIGS;
}
