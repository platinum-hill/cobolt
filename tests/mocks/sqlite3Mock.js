// Mock sqlite3 database
class Database {
  constructor(filename, mode, callback) {
    this.filename = filename;
    this.mode = mode;
    this.callback = callback;
    this.operations = [];
  }

  run(sql, params, callback) {
    this.operations.push({ type: 'run', sql, params });
    if (callback) callback(null);
    return this;
  }

  get(sql, params, callback) {
    this.operations.push({ type: 'get', sql, params });
    if (callback) callback(null, {});
    return this;
  }

  all(sql, params, callback) {
    this.operations.push({ type: 'all', sql, params });
    if (callback) callback(null, []);
    return this;
  }

  close(callback) {
    this.operations.push({ type: 'close' });
    if (callback) callback(null);
  }
}

module.exports = {
  Database,
  verbose: () => module.exports,
};
