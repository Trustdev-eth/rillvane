import {migrate} from './db-util.mjs';

function bind(sql, query, params) {
  return params.length ? sql.exec(query, ...params) : sql.exec(query);
}

export function wrapSqlStorage(sql, storage) {
  const db = {
    prepare(query) {
      return {
        get(...params) {
          const rows = bind(sql, query, params).toArray();
          return rows[0];
        },
        all(...params) {
          return bind(sql, query, params).toArray();
        },
        run(...params) {
          const cursor = bind(sql, query, params);
          return {changes: cursor.rowsWritten};
        }
      };
    },
    exec(query) {
      sql.exec(query);
    },
    transaction(fn) {
      return storage.transactionSync(fn);
    },
    close() {}
  };
  return db;
}

export function openDurableDatabase(storage) {
  return migrate(wrapSqlStorage(storage.sql, storage));
}
