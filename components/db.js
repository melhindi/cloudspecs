import * as duckdb from '@duckdb/duckdb-wasm';
const CSV_UPLOAD_PREFIX = "uploads/";
const ATTACH_NAME = 'specs';

const escapeIdentifier = (name) => `"${String(name).replaceAll('"', '""')}"`;
const escapeLiteral = (value) => String(value).replaceAll("'", "''");
const sanitizeTableName = (filename) => {
  const stem = filename.replace(/\.csv$/i, '').trim().toLowerCase();
  const normalized = stem
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');

  if (!normalized) {
    return 'data';
  }
  if (/^[0-9]/.test(normalized)) {
    return `data_${normalized}`;
  }
  return normalized;
};

export default class DB {
  #db; #conn;

  constructor(db, conn) {
    this.#db = db;
    this.#conn = conn;
  }

  static async create({ dbUrl, fileName }) {
    // Load duckdb wasm from jsdelivr
    const JSDELIVR_BUNDLES = duckdb.getJsDelivrBundles();
    const bundle = await duckdb.selectBundle(JSDELIVR_BUNDLES);
    const worker_url = URL.createObjectURL(
      new Blob([`importScripts("${bundle.mainWorker}");`], {type: 'text/javascript'})
    );

    // Instantiate the asynchronus version of DuckDB-wasm
    const worker = new Worker(worker_url);
    const logger = new duckdb.ConsoleLogger();
    const db = new duckdb.AsyncDuckDB(logger, worker);
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);

    // Fetch the database file
    //TODO: Could fail for large objects
    const arrayBuffer = new Uint8Array(await (await fetch(dbUrl)).arrayBuffer());

    // Register the file in DuckDB's virtual filesystem
    await db.registerFileBuffer(fileName, new Uint8Array(arrayBuffer));

    // create connection
    const conn = await db.connect();
    await conn.send(`ATTACH '${fileName}' AS ${ATTACH_NAME};`);
    await conn.send(`USE ${ATTACH_NAME};`);

    return new DB(db, conn);
  }

  async close() {
    try {
      await this.#conn.close();
    } catch (_error) {
      // Ignore connection teardown errors during database switching.
    }
    try {
      await this.#db.terminate();
    } catch (_error) {
      // Ignore worker teardown errors during database switching.
    }
  }

  async query(q) {
    try {
      const response = await this.#conn.query(q);
      const columns = response.schema.fields.map(field => field.name);
      // Bug fix explained at: https://github.com/GoogleChromeLabs/jsbi/issues/30
      const rows = JSON.parse(JSON.stringify(response.toArray(), (key, value) =>
          typeof value === 'bigint' ? parseInt(value.toString()) : value // return everything else unchanged
      ));
      let add = {};
      if ((new Set(columns)).size != columns.length){
        console.log("adding warning")
        add.warning = 'Your query returns duplicate column names which may not be rendered correctly.';
      }
      return { columns, rows, ...add };
    } catch (error) {
      return { error: error.toString()?.split("\n") }
    }
  }

  async getPreviewQuery(limit = 100) {
    try {
      const response = await this.#conn.query(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = '${escapeLiteral(ATTACH_NAME)}'
          AND table_type = 'BASE TABLE'
        ORDER BY table_name
        LIMIT 1
      `);
      const rows = response.toArray();
      const tableName = rows?.[0]?.table_name;
      if (!tableName) {
        return `SELECT 1 AS preview\nLIMIT ${limit}\n`;
      }
      return `SELECT *\nFROM ${escapeIdentifier(ATTACH_NAME)}.${escapeIdentifier(tableName)}\nLIMIT ${limit}\n`;
    } catch (_error) {
      return `SELECT 1 AS preview\nLIMIT ${limit}\n`;
    }
  }

  async importCSV(file) {
    const sourceName = file?.name || 'data.csv';
    const registeredName = `${CSV_UPLOAD_PREFIX}${Date.now()}-${sourceName.replace(/[^A-Za-z0-9._-]+/g, '_')}`;
    try {
      const buffer = new Uint8Array(await file.arrayBuffer());
      await this.#db.registerFileBuffer(registeredName, buffer);

      const baseName = sanitizeTableName(sourceName);
      let tableName = baseName;
      let suffix = 2;
      while (await this.#tableExists(tableName)) {
        tableName = `${baseName}_${suffix}`;
        suffix += 1;
      }

      await this.#conn.send(`
        CREATE TEMP TABLE ${escapeIdentifier(tableName)} AS
        SELECT *
        FROM read_csv_auto('${escapeLiteral(registeredName)}')
      `);
      return { tableName };
    } catch (error) {
      return { error: error.toString()?.split("\n") };
    }
  }

  async #tableExists(tableName) {
    try {
      await this.#conn.query(`SELECT 1 FROM ${escapeIdentifier(tableName)} LIMIT 1`);
      return true;
    } catch (_error) {
      return false;
    }
  }
};
