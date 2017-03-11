import {Any, Func, match} from 'tcomb';
import {doesTableExist, loadTable, saveTable} from './utilities/file';
import {executeQuery, queryTypes} from './utilities/query';
import {parse, validate} from './utilities/schema';
import assert from 'assert';
import {errors} from './literals';
import {getIDBInstance} from './idb';

const dbNames = new WeakMap();
const idbConfig = new WeakMap();
const tableData = new WeakMap();
const tableNames = new WeakMap();
const tableQueries = new WeakMap();
const tableSchemas = new WeakMap();

const defaultData = {
  index: {},
  rows: []
};

const sortFilterParameter = (filter, ifFunction, ifOther) => match(
  filter,
  Func, ifFunction,
  Any, ifOther
);

const executeQueries = (table, Schema) => tableQueries.get(table).reduce(
  (initialData, query) => executeQuery(query, initialData, Schema),
  table.tableData
);

const loadIdbConfig = (table, tableExist, Schema) => {

  const tableName = table.tableName;
  const idb = getIDBInstance(table.dbName);
  const config = idb.readTable(tableName);

  if (tableExist) {

    tableSchemas.set(table, parse(config.schema));

  } else {

    idb.createTable(tableName, Schema);
    tableSchemas.set(table, parse(Schema));

  }

  return config;

};

export class Table {

  get dbName() {

    return dbNames.get(this);

  }

  get tableData() {

    return tableData.get(this);

  }

  get tableName() {

    return tableNames.get(this);

  }

  get tableSchema() {

    return tableSchemas.get(this);

  }

  constructor(dbName, tableName, Schema) {

    const tableExist = doesTableExist(dbName, tableName);

    assert(dbName, errors.DB_NAME_IS_REQUIRED);
    assert(tableName, errors.TABLE_NAME_IS_REQUIRED);
    assert(Schema || tableExist, errors.SCHEMA_NAME_IS_REQUIRED);

    dbNames.set(this, dbName);
    tableNames.set(this, tableName);
    tableData.set(this, defaultData);
    tableQueries.set(this, []);

    idbConfig.set(this, loadIdbConfig(this, tableExist, Schema));

  }

  deleteRows(filter = () => true) {

    tableQueries.get(this).push(sortFilterParameter(
      filter,
      () => ({
        filter,
        type: queryTypes.DELETE_ROWS
      }),
      () => ({
        ids: [].concat(filter),
        type: queryTypes.DELETE_BY_ID
      })
    ));

    return this;

  }

  insert(...rows) {

    validate(this.tableSchema, ...rows);

    tableQueries.get(this).push({
      rows,
      type: queryTypes.INSERT
    });

    return this;

  }

  query(filter = () => true) {

    return new Promise((resolve, reject) => {

      loadTable(this.dbName, this.tableName, (error, data) => {

        if (error) {

          reject(error);

        } else {

          resolve(sortFilterParameter(
            filter,
            () => data.rows.filter(filter),
            () => [].concat(filter).map($$idbId => data.rows[data.index[$$idbId]])
          ));

        }

      });

    });

  }

  revert() {

    tableQueries.set(this, []);

    return this;

  }

  save() {

    return new Promise((resolve, reject) => {

      loadTable(this.dbName, this.tableName, (error, data) => {

        tableData.set(this, error ? defaultData : data);

        const newData = executeQueries(this, this.tableSchema);

        this.revert();

        const update = () => {

          tableData.set(this, newData);

          resolve();

        };

        return saveTable(
          this.dbName,
          this.tableName,
          newData,
          err => (err ? reject : update)()
        );

      });

    });

  }

  update(update, filter = () => true) {

    assert(typeof update === 'function', errors.INVALID_UPDATE_FUNCTION);

    tableQueries.get(this).push(sortFilterParameter(
      filter,
      () => ({
        shouldUpdate: filter,
        type: queryTypes.UPDATE,
        update
      }),
      () => ({
        ids: [].concat(filter),
        type: queryTypes.UPDATE_BY_ID,
        update
      })
    ));

    return this;

  }

}
